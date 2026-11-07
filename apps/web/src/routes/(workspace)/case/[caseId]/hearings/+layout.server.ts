import type { LayoutServerLoad } from './$types';
export const load:LayoutServerLoad=()=>({transcription:!!process.env.OPENAI_API_KEY});
