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
	testimony: 'I arrived at the warehouse at 9:30 PM, sir.',
	written: 'On Saturday, 14 March 2026, I arrived at the warehouse shortly after 20:00 WIB to take over from my colleague, Mr Yusuf, who was on the afternoon shift.',
	gate: 'An access card registered to R. Hartati was logged entering the East Gate on 14/03/2026 at 20:07:41.',
	shift: 'Mr Yusuf, the security guard on the afternoon shift. He left after I arrived.',
	charge: 'The defendant’s conduct is covered by and punishable under Article 374 of the Indonesian Criminal Code (KUHP).',
	firstQuestion: 'Where do you work, and when did you start?',
	firstAnswer: 'I’ve been a security guard at Warehouse B since early 2024. I work the night shift, from 8 PM to 8 AM.',
	timeQuestion: 'On Saturday, 14 March 2026, what time did you arrive at the warehouse?',
	laterAnswer: 'As I recall, it was 9:30 PM, sir. I’d stopped somewhere on the way.',
	vehicle: 'At around 23:45 WIB, I saw a white box truck leave through the East Gate. I could not clearly see who was driving because the lights in the loading area were off.',
	intro: 'Today, Monday, 16 March 2026, at 10:00 WIB, I, an investigator at Contoh Police Station, interviewed a witness who identified herself as Rina Hartati.',
	vehicleLog: 'A white box truck with registration number B 9123 XY was recorded leaving through the East Gate at 23:48:12. The footage from camera 4 does not show the driver’s face.',
	schedule: 'I have worked as a security guard at PT Sinar Logistik Contoh’s Warehouse B since January 2024. My night shift runs from 20:00 to 08:00 WIB.'
};

export const sources = [
	{ key: 'testimony', name: { id: 'Transkrip', en: 'Transcript' }, mark: { id: 'setengah sepuluh malam', en: '9:30 PM' }, href: '/demo/hearings/h2?s=s208' },
	{ key: 'written', name: { id: 'BAP saksi', en: 'Witness statement' }, mark: { id: 'sedikit setelah pukul 20.00 WIB', en: 'shortly after 20:00 WIB' }, href: '/demo/documents/d1?p=d1p4' },
	{ key: 'gate', name: { id: 'Log akses', en: 'Access log' }, mark: { id: '20:07:41', en: '20:07:41' }, href: '/demo/documents/d3?p=d3p2' }
] as const;

export function around(text: string, mark: string): [string,string,string] {
	const start = mark ? text.indexOf(mark) : -1;
	return start < 0 ? [text,'',''] : [text.slice(0,start), mark, text.slice(start+mark.length)];
}
