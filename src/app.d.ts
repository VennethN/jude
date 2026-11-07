import type { SessionInfo } from '$lib/domain';
declare global {
  namespace App {
    interface Locals {
      session: SessionInfo | null;
    }
  }
}
export {};
