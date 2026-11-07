import type { LayoutServerLoad } from './$types';
import type { Lang } from '@jude/core/domain';

export const load: LayoutServerLoad = ({ cookies, locals }) => {
  const lang: Lang = cookies.get('jude_lang') === 'en' || (!cookies.get('jude_lang') && locals.session?.prefs.lang === 'en') ? 'en' : 'id';
  return { lang, session: locals.session };
};
