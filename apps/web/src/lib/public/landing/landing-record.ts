export type LandingRecord = {
	testimony: string;
	written: string;
	gate: string;
	shift: string;
	charge: string;
	firstQuestion: string;
	firstAnswer: string;
	timeQuestion: string;
	laterAnswer: string;
	vehicle: string;
	intro: string;
	vehicleLog: string;
	schedule: string;
};

/** Display translations for the fixed, synthetic public story only.
 * Case records and the source links below always retain the Indonesian originals.
 */
export const englishExample: LandingRecord = {
	testimony: 'I arrived at the warehouse at half past nine at night, sir.',
	written: 'On Saturday, 14 March 2026, I arrived at the warehouse shortly after 20:00 WIB to relieve my colleague, Mr Yusuf, who was on the afternoon shift.',
	gate: 'The access card in the name of R. Hartati was recorded entering the East Gate on 14/03/2026 at 20:07:41.',
	shift: 'Mr Yusuf, the afternoon-shift security guard. He left after I arrived.',
	charge: 'The defendant’s conduct is provided for and punishable under Article 374 of the Indonesian Criminal Code (KUHP).',
	firstQuestion: 'Where do you work, and since when?',
	firstAnswer: 'I have been a security guard at Warehouse B since early 2024. I work the night shift, from eight in the evening to eight in the morning.',
	timeQuestion: 'On Saturday, 14 March 2026, what time did you arrive at the warehouse?',
	laterAnswer: 'As I recall, it was half past nine, sir. I had stopped somewhere on the way.',
	vehicle: 'At around 23:45 WIB, I saw a white box truck leave through the East Gate. I could not clearly see who was driving because the lights in the loading area were off.',
	intro: 'Today, Monday, 16 March 2026, at 10:00 WIB, I, an investigator at Contoh Police Station, examined a woman who identified herself as Rina Hartati as a witness.',
	vehicleLog: 'A white box truck with registration B 9123 XY was recorded leaving through the East Gate at 23:48:12. The footage from camera 4 does not show the driver’s face.',
	schedule: 'I have worked as a security guard at Warehouse B of PT Sinar Logistik Contoh since January 2024, on the night shift from 20:00 to 08:00 WIB.'
};

export const sources = [
	{ key: 'testimony', name: { id: 'Transkrip', en: 'Transcript' }, mark: { id: 'setengah sepuluh malam', en: 'half past nine at night' }, href: '/demo/hearings/h2?s=s208' },
	{ key: 'written', name: { id: 'BAP saksi', en: 'Witness statement' }, mark: { id: 'sedikit setelah pukul 20.00 WIB', en: 'shortly after 20:00 WIB' }, href: '/demo/documents/d1?p=d1p4' },
	{ key: 'gate', name: { id: 'Log akses', en: 'Access log' }, mark: { id: '20:07:41', en: '20:07:41' }, href: '/demo/documents/d3?p=d3p2' }
] as const;

export function around(text: string, mark: string): [string,string,string] {
	const start = mark ? text.indexOf(mark) : -1;
	return start < 0 ? [text,'',''] : [text.slice(0,start), mark, text.slice(start+mark.length)];
}
