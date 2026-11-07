# Working on Jude

Jude is an Indonesian-first courtroom workspace. Preserve source wording in both interface languages. Link findings and answers to the exact case record and keep synthetic examples labelled.

Start with PRODUCT.md and DESIGN.md for interface work. Apply Impeccable to the public pages and workspace, then inspect actual desktop and phone renders. Keep private case material in the server boundary. Every mutation checks the current organisation and case.

Use Conventional Commits 1.0.0. Write each subject as `type(scope): short description`. Use `feat` for a capability and `fix` for a correction. Use `!` or a `BREAKING CHANGE:` footer for an incompatible change. Commit completed slices progressively and stage only their files.

Run `pnpm check`, `pnpm test`, `pnpm build`, and the relevant browser tests before handoff.
