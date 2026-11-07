import { passages, statements } from '@jude/core/server/seed';
import { englishExample } from '$lib/public/landing/landing-record';
import type { PageServerLoad } from './$types';

/** Public examples use only the fixed synthetic record. */
export const load: PageServerLoad = async ({ parent }) => {
	const { lang } = await parent();
	const testimony = (id: string) => statements.find(line => line.id === id)!.text;
	const passage = (id: string) => passages.find(line => line.id === id)!.text;
	return {
		record: lang === 'en' ? englishExample : {
			testimony: testimony('s208'),
			written: passage('d1p4'),
			gate: passage('d3p2'),
			shift: testimony('s214'),
			charge: passage('d4p4'),
			firstQuestion: testimony('s205'),
			firstAnswer: testimony('s206'),
			timeQuestion: testimony('s207'),
			laterAnswer: testimony('s210'),
			vehicle: passage('d1p5'),
			intro: passage('d1p1'),
			vehicleLog: passage('d3p3'),
			schedule: passage('d1p2')
		}
	};
};
