import type { Lang, SessionInfo } from '@jude/core/domain';
declare global {
  namespace App {
    interface Locals {
      session: SessionInfo | null;
      lang: Lang;
    }
  }
}
export {};
