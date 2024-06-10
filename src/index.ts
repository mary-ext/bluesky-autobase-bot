import { BskyAuth, BskyXRPC, type AtpAccessJwt } from '@mary/bluesky-client';
import type { AppBskyFeedPost, ChatBskyConvoDefs } from '@mary/bluesky-client/lexicons';
import { decodeJwt } from '@mary/bluesky-client/utils/jwt';
import { withProxy } from '@mary/bluesky-client/xrpc';

import { EnvironmentSchema, StateStringSchema } from './schema';
import { countGraphemes, createInterval } from './utils';

const MESSAGES = {
	MENFESS_NEED_FOLLOW: `👋 Belum follow nih? Follow dulu!`,
	MENFESS_NEED_FOLLOWBACK: `👋 Tunggu follow-back nya dulu ya!`,
	MENFESS_TOO_LONG: `💢 Kepanjangan!`,
	MENFESS_EMPTY: `💢 Kosong!`,
	MENFESS_SENT: `📝 Terkirim`,

	MENFESS_REPORT: `🤖 Bot telah jalan`,
} as const;

// Actual bot logic
const MAX_POSTS_LENGTH = 300;

const env = EnvironmentSchema.parse(process.env, { mode: 'strip' });

const state = StateStringSchema.parse(
	await Bun.file(env.STATE_PERSISTENCE_FILE)
		.text()
		.catch((_) => undefined),
);

// 1. Create RPC client and authentication middleware
const rpc = new BskyXRPC({ service: env.ACCOUNT_SERVICE });
const auth = new BskyAuth(rpc);

console.log(`[-] signing in to ${env.ACCOUNT_IDENTIFIER}`);

// 2. Login to the account
// @todo: persist session? might not be worth doing for now.
await auth.login({
	identifier: env.ACCOUNT_IDENTIFIER,
	password: env.ACCOUNT_PASSWORD,
});

const did = auth.session!.did;
console.log(`[-] signed in (@${auth.session!.handle})`);

// 3. Verify that we're not signed in to the owner account
if (did === env.OWNER_DID) {
	console.error(`[!] OWNER_DID incorrectly set to the bot account (${did})`);
	console.error(`    please set it to a different account`);
	process.exit(1);
}

// 4. Verify that we have access to DMs
{
	const accessJwt = decodeJwt(auth.session!.accessJwt) as AtpAccessJwt;
	const scope = accessJwt.scope;

	if (scope === 'com.atproto.appPass') {
		console.error(`[!] no access to DMs! incorrect password type`);
		process.exit(1);
	}
}

// 5. Create a proxy to the actual DM service
const chatter = withProxy(rpc, { service: env.CHAT_SERVICE_DID as any, type: 'bsky_chat' });

const writeState = () => {
	return Bun.write(env.STATE_PERSISTENCE_FILE, JSON.stringify(state, null, '\t'));
};

const sendMessage = (convo: ChatBskyConvoDefs.ConvoView, text: string) => {
	return chatter.call('chat.bsky.convo.sendMessage', {
		data: { convoId: convo.id, message: { text: text } },
	});
};

const updateRead = (convo: ChatBskyConvoDefs.ConvoView) => {
	return chatter.call('chat.bsky.convo.updateRead', {
		data: { convoId: convo.id },
	});
};

createInterval({
	delay: 5_000,
	async run() {
		// List all conversations
		const response = await chatter.get('chat.bsky.convo.listConvos', {
			params: {
				limit: 100,
			},
		});

		// Work from old to new
		for (const convo of response.data.convos.reverse()) {
			// We'll grab the last message in the conversation
			const lastMessage = convo.lastMessage;

			// Skip if:
			// - We've read the conversation
			// - No last message (how?)
			// - Last message is deleted
			// - Sender is us
			if (
				convo.unreadCount === 0 ||
				!lastMessage ||
				lastMessage.$type !== 'chat.bsky.convo.defs#messageView' ||
				lastMessage.sender.did === did
			) {
				continue;
			}

			const user = convo.members.find((member) => member.did !== did)!;
			const viewer = user.viewer!;

			if (user.did === env.OWNER_DID) {
				if (lastMessage.text === `-toggle-watch`) {
					state.menfess_watch = !state.menfess_watch;

					await writeState();

					await sendMessage(convo, `watch: ${state.menfess_watch ? `on` : `off`}`);
					await updateRead(convo);

					continue;
				}

				if (lastMessage.text === `-toggle-follow`) {
					state.menfess_require_followback = !state.menfess_require_followback;

					await writeState();

					await sendMessage(convo, `require_followback: ${state.menfess_require_followback ? `on` : `off`}`);
					await updateRead(convo);

					continue;
				}
			}

			// Check if we're running, and see if the text starts with the prefix
			if (state.menfess_watch && lastMessage.text.startsWith(env.MENFESS_PREFIX + ' ')) {
				// Mark as read if blocking
				if (viewer.blocking || viewer.blockedBy) {
					await updateRead(convo);
					continue;
				}

				// Warn if not following
				if (!viewer.followedBy) {
					await sendMessage(convo, MESSAGES.MENFESS_NEED_FOLLOW);
					await updateRead(convo);
					continue;
				}

				// Warn if we haven't followed back
				if (state.menfess_require_followback && !viewer.following) {
					await sendMessage(convo, MESSAGES.MENFESS_NEED_FOLLOWBACK);
					await updateRead(convo);
					continue;
				}

				const length = countGraphemes(lastMessage.text);

				// Warn if the text is too long
				if (length > MAX_POSTS_LENGTH) {
					await sendMessage(convo, MESSAGES.MENFESS_TOO_LONG);
					await updateRead(convo);
					continue;
				}

				// Warn if there's nothing to send
				if (lastMessage.text.slice(env.MENFESS_PREFIX.length + 1).trim().length === 0) {
					await sendMessage(convo, MESSAGES.MENFESS_EMPTY);
					await updateRead(convo);
					continue;
				}

				// Send a post, this one doesn't go through the DM proxy
				{
					// Mentions and links works by attaching a facet to the `facets` array,
					// they indicate which parts of the text is a decoration.
					const record: AppBskyFeedPost.Record = {
						createdAt: new Date().toISOString(),
						text: lastMessage.text,
						facets: lastMessage.facets,
					};

					await rpc.call('com.atproto.repo.createRecord', {
						data: {
							repo: did,
							collection: 'app.bsky.feed.post',
							record: record,
						},
					});
				}

				// We've sent the post, send a confirmation
				await sendMessage(convo, MESSAGES.MENFESS_SENT);
				await updateRead(convo);

				continue;
			}
		}
	},
	handleError(err) {
		// @todo: i think this should do more?
		console.error(err);
	},
});

// Report the monitoring status at launch if requested
if (env.MENFESS_REPORT_AT_LAUNCH) {
	// Get the conversation ID between bot and the owner
	const response = await chatter.get('chat.bsky.convo.getConvoForMembers', {
		params: {
			members: [env.OWNER_DID],
		},
	});

	const convo = response.data.convo;

	const message =
		MESSAGES.MENFESS_REPORT +
		`\n    menfess_watch: ${state.menfess_watch ? `on` : `off`}` +
		`\n    menfess_require_followback: ${state.menfess_require_followback ? `on` : `off`}`;

	await sendMessage(convo, message);
}
