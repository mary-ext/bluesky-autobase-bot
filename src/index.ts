import * as v from '@badrap/valita';

import { BskyAuth, BskyXRPC, type AtpAccessJwt } from '@mary/bluesky-client';
import type { AppBskyFeedPost, ChatBskyConvoDefs } from '@mary/bluesky-client/lexicons';
import { decodeJwt } from '@mary/bluesky-client/utils/jwt';
import { withProxy } from '@mary/bluesky-client/xrpc';

import { countGraphemes, createInterval } from './utils';

const MAX_POSTS_LENGTH = 300;

const env = v
	.object({
		ACCOUNT_SERVICE: v.string().default('https://bsky.social'),
		ACCOUNT_IDENTIFIER: v.string(),
		ACCOUNT_PASSWORD: v.string(),
		CHAT_SERVICE_DID: v.string().default('did:web:api.bsky.chat'),
		// PERSISTENCE_FILE: v.string().default('./data/state.v1.json'),
	})
	.parse(process.env, { mode: 'strip' });

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

// 3. Verify that we have access to DMs
{
	const accessJwt = decodeJwt(auth.session!.accessJwt) as AtpAccessJwt;
	const scope = accessJwt.scope;

	if (scope === 'com.atproto.appPass') {
		console.error(`[!] signed in without access to DMs! incorrect password type`);
		process.exit(1);
	}
}

const did = auth.session!.did;
console.log(`[-] signed in (@${auth.session!.handle})`);

// 4. Create a proxy to the actual DM service
const chatter = withProxy(rpc, { service: env.CHAT_SERVICE_DID as any, type: 'bsky_chat' });

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
			// - We've read the conversation (probably means we're blocking)
			// - No last message (how?)
			// - Last message is deleted
			// - Sender is us (we send a reply to mark that we've processed it)
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

			// Mark as read if blocking
			if (viewer.blocking || viewer.blockedBy) {
				await updateRead(convo);
				continue;
			}

			// Warn if not following
			if (!viewer.followedBy) {
				await sendMessage(convo, `👋 Belum follow nih? Follow dulu!`);
				await updateRead(convo);
				continue;
			}

			// Warn if we haven't followed back
			if (!viewer.following) {
				await sendMessage(convo, `👋 Tunggu follow-back nya dulu ya!`);
				await updateRead(convo);
				continue;
			}

			const length = countGraphemes(lastMessage.text);

			// Warn if the text is too long
			if (length > MAX_POSTS_LENGTH) {
				await sendMessage(convo, `💢 Kepanjangan!`);
				await updateRead(convo);
				continue;
			}

			// Warn if there's nothing to send
			if (lastMessage.text.trim().length === 0) {
				await sendMessage(convo, `💢 Kosong!`);
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

			// We've sent the post, so let's send a reply to mark we're done here.
			await sendMessage(convo, `📝 Terkirim`);
			await updateRead(convo);
		}
	},
	handleError(err) {
		// @todo: i think this should do more?
		console.error(err);
	},
});
