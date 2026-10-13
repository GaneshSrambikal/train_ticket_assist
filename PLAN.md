# IRCTC personal General and Tatkal booking assistant

Research date: 12 October 2026 (Asia/Kolkata).
Status: implementation started on 13 October 2026. Browser access, configuration,
timing guidance, single-run locking, metadata journaling, search preparation,
search submission and exact train/date/class selection are implemented. Guided
Book Now, optional username/password autofill with manual verification handoff, passenger autofill and a persistent
unresolved-attempt guard are implemented with local fixture tests. The authenticated
flow is not yet verified against a real booking. Final review/payment are manual;
automatic confirmation detection and complete booking validation remain pending.
Scope selected by the user: personal booking on Windows, supporting both General
and Tatkal quotas in the first version, with Tatkal retaining priority.

## Recommendation

Use TypeScript, Node.js 24 LTS, Playwright and visible Google Chrome. Build a
local command-line assistant with a browser the user can take over at any time.
Automate journey selection, form filling and review preparation; pause for
CAPTCHA, OTP, final review and payment. Start with one account and one active
booking attempt. The project does not promise ticket availability or a seat.

The first deliverable is a browser-access feasibility experiment, not a complete
booking bot. In this workspace, Cypress 16.1.1 repeatedly produced ECONNRESET
against IRCTC, including in an isolated project. Visible Playwright Chrome
returned HTTP 200 and rendered the welcome dialog once; headless Playwright
failed with ERR_HTTP2_PROTOCOL_ERROR. These observations favor visible Chrome
but do not establish reliable access or prove why Cypress failed.

## Research findings

1. Railway reporting dated 13 February 2026 confirms CAPTCHA, CDN, WAF and
   anti-bot controls including Akamai. This makes traffic filtering a plausible
   explanation for the earlier failures, not a proven diagnosis. [1]
2. The 11 June 2025 announcement requires Aadhaar-authenticated users for online
   Tatkal from 1 July 2025 and Aadhaar OTP from 15 July 2025. The assistant must
   handle verification prompts explicitly and allow the user time to finish. [2]
3. Booking times and quota rules must be rechecked against current official
   guidance during implementation. Use the train's originating-station departure
   date when determining the Tatkal opening day, which may differ from the
   passenger's boarding date. Store dates and scheduled events in Asia/Kolkata.
   Current Tatkal guidance describes booking one day before departure from the
   originating station; verify the AC/non-AC opening time before scheduling. [2][3]
4. Playwright provides role/label locators, actionability checks, browser control
   and local debugging tools suited to a changing, asynchronous booking UI. [4][5]
5. Browser session state can contain credentials capable of impersonating the
   user. Keep sessions outside Git and treat diagnostic artifacts as sensitive. [6]
6. IRCTC's accessible terms page includes legacy information (including I-ticket
   delivery), so it is not a reliable source for current booking limits. Review
   the current terms presented by the live service before live transaction work.
   This research does not establish permission for unattended browser booking. [7]

## Stack comparison

| Option | Assessment |
| --- | --- |
| Playwright + TypeScript + visible Chrome | Preferred: fits the existing Node environment, readable typed workflow and strong locator/debugging APIs; one successful local navigation. |
| Selenium WebDriver | Established alternative for a controlled compatibility comparison if Playwright access proves unreliable; no evidence it will overcome this site's failures. [8] |
| Cypress | Useful for application tests, but repeated site-access failures here make it a poor starting point for this personal booking assistant. |
| Direct HTTP/private endpoints | Do not base the project on undocumented booking requests; session challenges and transaction handling remain unresolved. |

Supporting choices: Zod for local input validation, Node's test runner for pure
logic, Playwright Test for offline UI scenarios, JSON files for local settings and
a small redacted run journal. Pin dependency versions and commit a lockfile.
No database, cloud deployment or web dashboard is needed for the first version.

## Proposed project layout

```text
irctc-booking-assistant/
  PLAN.md
  README.md
  package.json
  tsconfig.json
  config/journey.example.json
  config/journey.general.example.json
  config/journey.tatkal.example.json
  src/cli.ts
  src/browser.ts
  src/config.ts
  src/workflow.ts
  src/pages/{login,search,trains,passengers,review,confirmation}.ts
  src/tatkal-clock.ts
  src/journal.ts
  tests/unit/
  tests/fixtures/
  tests/ui/
  .local/                 # ignored: private inputs, session and run journal
  artifacts/              # ignored: opt-in diagnostic material
```

The layout above is the target structure. See README.md for the currently
implemented commands; later workflow modules are not yet present.

### Implementation evidence (13 October 2026)

- Visible Chrome reached editable IRCTC search controls.
- Live General and Tatkal checks selected NDLS/MAS station suggestions, a date,
  AC 3 Tier and the requested quota, without pressing Search.
- Corrected station aria-label matching, the language dialog's overridden
  accessible name and the PrimeNG date picker's keyboard-event behavior.
- Local tests cover dates/timing, locking, journal transitions, both quota forms,
  ambiguous station suggestions and the language dialog.
- These are successful bounded checks, not a claim of ongoing reliability or
  an end-to-end booking validation. Do not mark the remaining phases complete.
- Subsequent live search verified the configured train's results, class/date
  selection, availability and fare. The example's ERN search returned a train
  arriving at ERNAKULAM JN.; the station-match guard correctly reported a mismatch.
  No Book Now, login or purchase was performed during live verification.

## Workflow and transaction handling

Model explicit states:

`READY -> LOGIN_REQUIRED -> SEARCH -> TRAIN_SELECTED -> PASSENGERS -> REVIEW
-> USER_PAYMENT -> CONFIRMED | FAILED | UNKNOWN`

CAPTCHA/OTP prompts enter an `AWAITING_USER` state and return to the prior state
only after the page confirms completion. Detect expired sessions and re-login;
never assume cookies guarantee authentication.

Journey input includes station codes, boarding station, journey date, train
number, class, quota, passengers, berth preferences and acceptable fare. Use
semantic locators and scoped train cards; avoid generated Angular classes and
long nth-child selector chains. Confirm the selected train/date/class before
continuing. Stop for review if fare, quota, route or availability changes.

Require an explicit quota choice: `GENERAL` or `TATKAL`. Share login, search,
passenger entry, review and payment handling across both modes. Select and verify
the requested quota in the live UI and include it in review and the run journal.
Never silently fall back to another quota when the requested one is unavailable.

General mode skips the Tatkal countdown and Tatkal-specific prerequisites. It
still handles any verification the live site presents and validates the current
General booking window before proceeding. Tatkal mode applies its originating-date
and opening-time checks. Verify current General reservation-window rules during
implementation rather than copying numeric limits from the legacy terms page.

Keep CAPTCHA/OTP entry and payment authorization in the user's browser. Do not
store Aadhaar numbers, OTPs, card details or UPI PINs. The default live workflow
stops at review until the user elects to continue with the actual transaction.

Maintain a local run ID, state transitions and booking reference when available.
Serialize attempts. Retry only clearly non-transactional navigation with a small
bounded backoff. A timeout after a booking/payment action becomes UNKNOWN, not
an automatic retry: inspect booking history/transaction status before another
attempt. A local journal prevents accidental local duplication but cannot supply
server-side idempotency. Declare success only when confirmation and a booking
reference are visible, not merely on return from a payment gateway.

## Delivery phases and completion checks

1. **Browser feasibility.** Scaffold the project, launch visible Chrome in an
   isolated context/profile, navigate and identify the actual search form.
   Make three user-triggered checks across separate sessions, not rapid retries.
   Capture browser/version/error metadata. Pass when the search controls are
   usable repeatedly; HTTP 200 alone is insufficient. If blocked, report the
   evidence and keep manual access available; do not build on a false success.

2. **Quota configuration and login.** Validate journey/passenger configuration
   for both General and Tatkal, provide synthetic examples for each mode,
   add a single-run lock, support manual login/CAPTCHA/OTP and verify signed-in
   state. For Tatkal, add a local clock/readiness check and a configurable opening-time
   countdown verified against current rules. Re-read the clock after sleep/resume;
   never submit early. Pass when invalid configuration fails before navigation,
   expired sessions recover and the timing calculations pass date-boundary tests.
   General mode must proceed without waiting for a Tatkal opening time.

3. **Search and selection.** Fill route/date/quota, locate the exact train and
   class, and interpret availability. Handle sold-out, changed fare and missing
   trains. Verify the selected quota as well as train/class. Pass offline scenarios
   for both quotas and supervised live search checks without booking.

4. **Passenger entry and review.** Enter configured details and display a concise
   review of train, date, quota, class, passengers, boarding point and fare. Pause for
   additional verification. Pass when the review matches inputs and changes stop
   the workflow. Do not repeatedly create live reservations to test this phase.

5. **Payment handoff and result.** Let the user authorize payment in the browser;
   detect confirmation, cancellation and ambiguous results. Save only minimal
   booking metadata locally. Exercise duplicate prevention and payment timeout
   behavior against fixtures. A real purchase is a separate user-chosen booking,
   not a routine automated test.

6. **Hardening and handover.** Package clear Windows setup/run instructions,
   stop/resume behavior, version diagnostics and fixture regression tests.
   Use traces only for non-sensitive steps; raw traces can capture DOM/network
   secrets, so disabling logging alone is insufficient. Mask optional screenshots
   and avoid tracing login, passengers and payment by default.

## Testing strategy

- Unit tests: station/date validation, originating-date calculations, IST opening
  time, quota validation, General skipping Tatkal timing, state transitions,
  run lock and UNKNOWN-outcome recovery.
- Offline browser fixtures: delayed controls, changed layouts, login expiry,
  CAPTCHA/OTP pauses, no availability, fare changes and payment cancellation.
  Cover General and Tatkal selection, quota mismatches and unavailable quotas.
- Real-site checks: explicit, low-volume navigation/search checks; excluded from
  default CI. Never run a full booking flow as an automatically retried test.
- Final acceptance: both General and Tatkal workflows supported; reliable page
  access; correct journey/quota selection and review;
  visible user handoffs; no secret logging; no duplicate attempt after ambiguity.

## Remaining decisions and limitations

Exact journeys and passenger details are not needed to implement the scaffold;
use synthetic examples first. Credentials will be entered locally, not in chat.
General and Tatkal are both target booking workflows, not just smoke-test modes.
Revalidate live UI and current policies for each quota before adding transactions.
No fixed delivery estimate is credible until the browser feasibility milestone
passes. No framework can guarantee a scarce Tatkal ticket or ongoing site access.

## Sources

[1] Ministry of Railways, 13 February 2026, cybersecurity and Tatkal authentication:
https://www.pib.gov.in/PressReleasePage.aspx?PRID=2227511&lang=1&reg=6

[2] Ministry of Railways, 11 June 2025, Tatkal authentication changes:
https://www.pib.gov.in/PressReleasePage.aspx?PRID=2135694&lang=2&reg=48

[3] IRCTC Tatkal FAQ:
https://contents.irctc.co.in/en/TatkalFaq.html

[4] Playwright best practices:
https://playwright.dev/docs/best-practices

[5] Playwright locators and browser support:
https://playwright.dev/docs/locators
https://playwright.dev/docs/browsers

[6] Playwright authentication and storage-state guidance:
https://playwright.dev/docs/auth

[7] IRCTC terms (contains legacy details; not used for current numeric limits):
https://contents.irctc.co.in/en/term_src1.html

[8] Selenium overview:
https://www.selenium.dev/documentation/en/introduction/
