// Read-only page probe for the OPT-0018 R2 "A-route diagnostic".
//
// WHY IT EXISTS
// The R1/R2 harness (D:/_work/SpMusic-drag-memory-r1-kit/lib/coverlane-page.mjs) already
// hooks the Image constructor, but only counts *creations*. R2 section 3 needs three
// numbers that instrumentation cannot produce:
//   B -> cover <img> elements mounted while OFF-SCREEN, their unique URLs and source area.
//   C -> temporary predecodes IN FLIGHT at once: peak, distribution, duration.
//   D -> for one derived identity (same URL), how often a request duplicates one already
//        running, i.e. how much of the predecode traffic is redundant.
//
// WHAT IT MUST NOT DO
// It must not start a request or change scheduling:
//   * window.Image is proxied but every construction still calls through to the original,
//     so application code receives a genuine HTMLImageElement;
//   * "in flight" is counted from the src assignment (the first moment a request can
//     exist) and released on load/error, or on reassignment;
//   * DOM <img> painting is counted separately, and DOM images do not pass through the
//     src property setter (React sets the attribute), so the two volumes stay distinct.
//
// The probe is measurement-only. Deleting this file restores exactly the R1 harness.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIAG_PROBE_VERSION = 'r2diag/1'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE_SOURCE = readFileSync(join(HERE, 'r2diag-probe.page.js'), 'utf8')

export function diagProbeScript() {
  return PAGE_SOURCE.replace(/__VERSION__/g, DIAG_PROBE_VERSION)
}
