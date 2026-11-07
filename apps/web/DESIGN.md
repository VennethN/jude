---
name: Jude
description: A counsel table for testimony, source records and the questions between them.
colors:
  paper: "#f5f3ec"
  surface: "#fffdf7"
  ink: "#203229"
  forest: "#183e33"
  muted: "#59675c"
  accent: "#864857"
  line: "#d7d9cc"
  conflicts: "#aa4b29"
  context: "#72549e"
  supports: "#186e59"
  night-conflicts: "#ef9b72"
  night-context: "#b49cde"
  night-supports: "#75bc9d"
  workspace-paper: "#f3f2eb"
  workspace-surface: "#fcfbf7"
  workspace-ink: "#24372c"
  workspace-muted: "#657164"
  workspace-selected: "#e6ede0"
  night-paper: "#0d1612"
  night-surface: "#121d18"
  night-ink: "#dde2d6"
  night-muted: "#92a092"
  night-selected: "#1b2c23"
  status-supported: "#deeadc"
  status-inconsistency: "#f2dcae"
  status-context: "#e4e5ed"
  status-insufficient: "#e9e8e0"
  night-status-supported: "#1c3527"
  night-status-inconsistency: "#44310f"
  night-status-context: "#272a3c"
  night-status-insufficient: "#2a2a25"
typography:
  display: { fontFamily: "Caslon Display", fontWeight: 400 }
  body: { fontFamily: "Manrope", fontWeight: 400 }
  record: { fontFamily: "Courier Prime", fontWeight: 400 }
  brand: { fontFamily: "Rufina", fontWeight: 400 }
rounded: { control: 8px, sheet: 14px }
spacing: { compact: 8px, field: 16px, group: 24px, section: 40px }
---

# The counsel table

The public cover feels like a closed case file. Inside, the working surface opens into an indexed reading room. Forest green anchors the navigation. Warm paper carries testimony and evidence. A wine-coloured annotation marks a matter requiring a lawyer’s attention.

## Typography and layout

Set the wordmark, page covers and case titles in Rufina, hearing and finding titles in Caslon Display, testimony in Manrope and filed extracts in Courier Prime. Align each document reference with its quote. A case starts with its most consequential open question. Place hearing and exhibit indexes below it. Use one broad reading column on a phone and a fixed, labelled navigation rail when there is room.

## Components

Text and shape accompany review status. A paper folio can carry a single prominent case or comparison. Ordinary lists use fine dividers. Dialogs have a visible close control, initial focus, Escape dismissal and a return focus target. Use short eased transitions for navigation, selection and inspection. Preserve a fully static reduced-motion presentation.

## Night

Use deep green-grey paper with lighter text. Keep written sources and testimony typographically distinct in both themes, including high-contrast and coarse-pointer layouts.

## Comparing testimony

Show the testimony and filed phrase together wherever space permits. Give each its own source link. On the overview a running hearing sits in the page flow above the case title. A tablet or phone keeps the assistant available in the top bar.

## Finding status and review

Each status chip pairs its label with a distinct shape. Supported uses a filled sage circle, a potential inconsistency an amber diamond, context needed a hollow violet ring, and insufficient evidence a grey dash. The queue uses round attention marks for open findings and a check once counsel has reviewed a finding. Group rows by hearing and order them by testimony time. A sage fill and border hold the selection as keyboard focus moves.

The workspace and billing pages share the paper and night palettes in `src/lib/workspace/palette.css`. Keep written sources in Courier Prime and spoken testimony in Manrope. Mark the cited words with a tinted background and underline so the phrase stays identifiable in both themes.

## Public cover and motion

Give the forest cover a paper margin. Set the two-line headline above a wide comparison sheet and leave open space around the clay gavel. The desk, paper spreads and legal miniatures follow the reader through the public story. Inside a case, reserve that space for the live transcript, pending review, next hearing and original sources. [Live design reference](https://vennethn.github.io/sable-mockup/)

On the landing page, ease wheel and trackpad scrolling with a 0.11 interpolation factor. Keep touch scrolling native. The paper spreads follow scroll position in either direction with a cubic ease-out. Wide screens pin every spread, and narrow screens at least 560px tall pin the six-paper desk. A short viewport keeps the desk in the document flow. Reduced motion shows the finished exhibits and all source links.

In the workspace, use 220ms for a page or layout change, 170ms for hover and selection, and 260ms for sliding panels. A press responds immediately. Transcription, timecodes and recording controls follow their actual state.
