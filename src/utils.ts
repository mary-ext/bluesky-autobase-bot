export interface CreateIntervalOptions {
	delay: number;
	run(): Promise<void>;
	handleError(err: unknown): void;
}

export const createInterval = ({ delay, run, handleError }: CreateIntervalOptions) => {
	const controller = new AbortController();
	const signal = controller.signal;

	let timeout: any;

	const execute = () => {
		run()
			.catch(handleError)
			.finally(() => {
				if (signal.aborted) {
					return;
				}

				timeout = setTimeout(execute, delay);
			});
	};

	execute();

	signal.addEventListener('abort', () => {
		clearTimeout(timeout);
	});

	return controller;
};

// Bluesky's post length is determined by graphemes, which is how a person
// "consider" a sequence of character to be 1 letter.
const segmenter = new Intl.Segmenter();
export const countGraphemes = (text: string): number => {
	var iterator = segmenter.segment(text)[Symbol.iterator]();
	var count = 0;

	while (!iterator.next().done) {
		count++;
	}

	return count;
};
