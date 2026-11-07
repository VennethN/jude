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

export const sources = [
	{ key: 'testimony', name: { id: 'Transkrip', en: 'Transcript' }, mark: 'setengah sepuluh malam', href: '/demo/hearings/h2?s=s208' },
	{ key: 'written', name: { id: 'BAP saksi', en: 'Witness statement' }, mark: 'sedikit setelah pukul 20.00 WIB', href: '/demo/documents/d1?p=d1p4' },
	{ key: 'gate', name: { id: 'Log akses', en: 'Access log' }, mark: '20:07:41', href: '/demo/documents/d3?p=d3p2' }
] as const;

export function around(text: string, mark: string): [string,string,string] {
	const start = mark ? text.indexOf(mark) : -1;
	return start < 0 ? [text,'',''] : [text.slice(0,start), mark, text.slice(start+mark.length)];
}
