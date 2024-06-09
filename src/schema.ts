import * as v from '@badrap/valita';

import type { At } from '@mary/bluesky-client/lexicons';

const BoolStringSchema = v.union(v.literal('false'), v.literal('true')).chain((r) => v.ok(r === 'true'));
const DidStringSchema = v.string().assert((r): r is At.DID => r.startsWith('did:'));

const FilledStringSchema = v.string().assert((r) => r.length >= 1);

export const EnvironmentSchema = v.object({
	ACCOUNT_SERVICE: FilledStringSchema.default('https://bsky.social'),
	ACCOUNT_IDENTIFIER: FilledStringSchema,
	ACCOUNT_PASSWORD: FilledStringSchema,

	MENFESS_PREFIX: FilledStringSchema,
	MENFESS_REPORT_AT_LAUNCH: BoolStringSchema,

	OWNER_DID: DidStringSchema,

	CHAT_SERVICE_DID: DidStringSchema.default('did:web:api.bsky.chat'),

	STATE_PERSISTENCE_FILE: FilledStringSchema.default('./state.json.local'),
});

export const StateSchema = v.object({
	menfess_watch: v.boolean().default(true),
	menfess_require_followback: v.boolean().default(true),
});

export const StateStringSchema = v
	.string()
	.optional()
	.chain((raw, options) => {
		let json: unknown = {};

		if (raw) {
			try {
				json = JSON.parse(raw);
			} catch {
				return v.err(`Cannot read state file, potentially corrupted?`);
			}
		}

		return StateSchema.try(json, options);
	});
