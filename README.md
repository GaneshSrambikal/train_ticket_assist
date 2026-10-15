# IRCTC booking assistant

Visible-Chrome search and guided booking for General and Tatkal. The assistant
can select a train/date/class, start Book Now, wait for you to log in and complete
verification, and fill passenger fields. Final review and payment are manual.

Requires Windows, Node.js 24+, and installed Google Chrome.

```powershell
cd D:\upscale_envo\automation\tickets\irctc-booking-assistant
npm.cmd install
npm.cmd start
```

Chrome opens the IRCTC search page in an isolated session. Close Chrome or press
Ctrl+C to exit. The assistant checks that the search form is editable; an HTTP
200 response alone is not considered success. On a failure it leaves Chrome
open for manual inspection. No login credentials are required for this step.

For one live check that closes automatically:

```powershell
npm.cmd run check:live
```

## Configure a journey

Copy an example into the ignored `.local` directory and edit it with your actual
journey. Examples are synthetic, contain fixed dates and will eventually expire.
Station codes, train routes and class availability must be checked on IRCTC.

```powershell
New-Item -ItemType Directory -Force .local
Copy-Item config/journey.general.example.json .local/journey.json
# Or copy config/journey.tatkal.example.json for Tatkal.
npm.cmd run validate -- .local/journey.json
npm.cmd run prepare -- .local/journey.json
```

`validate` checks input format and past dates without opening a browser. Tatkal
requires `trainOriginDate`, which can differ from your boarding date. The command
prints an IST opening-time estimate; it does not establish quota eligibility.
General skips this timing calculation.

`prepare` opens the page and attempts to select station suggestions, date, class
and quota. It **does not press Search**, enter passengers, log in or submit a
booking. Inspect the prepared fields in Chrome. The schema includes passenger
and fare settings for later milestones; they are not yet used by the browser.
Use the commands below to proceed beyond preparation.

## Search for the configured train

```powershell
npm.cmd run search -- config/journey.general.example.json
```

This fills the form, clicks Search Trains, finds the exact configured train,
selects its class and date, and prints availability and the displayed fare.
Chrome stays open. Search does not click Book Now. The configured train must
appear in the results; missing trains, unavailable classes or unsupported layouts
stop the workflow without choosing an alternative.

## Continue toward booking

First use a separate `.local/journey.json` with your real journey and passenger
details. The `book` command rejects `.example.json` files and placeholder names.
Check the station codes: IRCTC can return nearby stations, and the assistant
will not automatically book a train whose displayed endpoints differ from the
requested stations.

```powershell
npm.cmd run book -- .local/journey.json
```

1. Search and inspect the chosen train, route, date, class, quota and availability.
2. In the terminal, type `BOOK` followed by the configured train number when
   prompted (for example, `BOOK 12622`). A different response cancels this step.
3. The assistant clicks Book Now once. If configured, login autofill enters your
   username and password and clicks Sign In once if no CAPTCHA/OTP is visible.
   Complete any verification and confirmation dialogs in Chrome. It waits up to
   ten minutes for passenger entry.
4. The assistant adds passenger rows and fills name, age, gender and berth
   preference. This authenticated portion has fixture tests, but has not yet
   been verified against a real logged-in booking session.
5. The assistant selects BHIM/UPI and leaves Chrome open. Automatic Continue is
   temporarily disabled to investigate the session error. Click Continue yourself
   in this same Chrome window and observe the result. If the page is still loading,
   do not submit again. Finish any validation or dialogs manually.
   Review every passenger, boarding station,
   nationality, food preference and contact field. Verify the final total against
   `maxFare` and authorize payment yourself. The assistant never clicks Pay.

Waitlisted/RAC availability is blocked by default. Add `"allowWaitlist": true`
only if you accept that outcome. Unknown/closed availability, station mismatch,
changed quota/date/class, changed fare and a fare already above `maxFare` stop
the booking. The displayed search fare is not a guaranteed final total for all
passengers; final total enforcement remains your review responsibility.
Tatkal checks its configured opening time before Book Now; it does not poll or
automatically wait for the opening. Live quota eligibility/booking windows remain
authoritative.

## Diagnose a browser/session error

Close any running assistant, then run `npm.cmd run diagnose`. This opens the same
Chrome channel and fresh context as the booking assistant. Perform the flow
manually through Continue, then close that window after reaching review or the
error page. No credentials or journey configuration are read, and no buttons
are clicked automatically in this mode.

The printed `artifacts/diagnostic-*.jsonl` file records Chrome version, launch
switch names when Chrome exposes them (without values), and document/XHR/fetch status codes, elapsed
timings and network error codes. Request IDs correlate events within the report.
It excludes URLs, query strings, request/response bodies, headers, cookies and
page contents. A successful HTTP response can still contain an application error;
status codes alone do not establish the cause. No HAR or trace is captured.

For comparison, open `chrome://version` in your normal Chrome and compare its
version with the version printed by the diagnostic command. Check its command
line locally against `launchSwitchNames`; do not share the whole version page
because it contains profile paths and command-line values. Do not change launch
flags based only on their presence. In normal Chrome's Network panel, you can
compare the Fetch/XHR status and duration immediately after Continue; avoid
exporting a HAR or sharing payloads, headers, cookies or full request URLs.

## Login autofill

Edit `.local/credentials.json` on your computer:

```json
{
  "username": "your-irctc-username",
  "password": "your-irctc-password"
}
```

If that file does not exist, copy `config/credentials.example.json` there first.
The local file is plaintext and ignored by Git; do not share it or put credentials
in the journey file. Credentials are loaded only for `book`, validated before
opening Chrome, and omitted from logs and reports. No login screenshots or traces
are taken. A complete `IRCTC_USERNAME`/`IRCTC_PASSWORD` environment-variable pair
overrides the file. With neither source configured, login remains manual.

Run the same `npm.cmd run book -- .local/journey.json` command. Once login appears,
the assistant fills username/password and checks for visible CAPTCHA/OTP controls,
allowing a short interval for delayed controls. If none appears and Sign In is
enabled, it clicks Sign In once. Otherwise, complete verification and submit
manually. This check applies to both quotas; General does not imply verification
is absent. Any verification requested after submission remains manual.
If already at passenger entry, autofill is skipped. It does not solve CAPTCHA, retry invalid
credentials or save browser authentication between runs. On autofill failure,
enter credentials manually; the passenger-form wait continues.

## After a booking attempt

Before Book Now, a persistent `.local/booking-attempt.json` guard is written.
Closing Chrome or a network failure does not erase it or retry the booking.
Check IRCTC booking and transaction history to establish the outcome, then close
the assistant and run:

```powershell
npm.cmd run resolve-booking
```

Type `CHECKED` only after confirming there is no unresolved payment/booking.
This acknowledges the previous attempt and permits a new one. It does not verify
the outcome automatically, cancel tickets, or retry payment. Passenger data is
not included in the guard file.

Verified on 13 October 2026: visible Chrome reached the live search form and
prepared NDLS/MAS, date, AC 3 Tier and both General/Tatkal quotas without pressing
Search. The language dialog and date-picker behavior were checked against the
live site. This does not establish reliable booking or payment behavior.

Only one browser run is permitted at a time. Locks from exited processes are
recovered automatically on the next launch. A live owner is preserved; close its
Chrome window or press Ctrl+C in its terminal before restarting. Invalid locks or
an interrupted recovery require manual inspection before removing the indicated
lock file. The assistant never kills another process to claim its lock.

## Diagnostics and checks

- `npm.cmd run typecheck`: TypeScript checks.
- `npm.cmd test`: local tests; never books or calls IRCTC.
- `artifacts/<run-id>.json`: browser version and check outcome, no screenshots.
- `.local/runs/<run-id>.jsonl`: state transitions only, no passenger data.

Raw traces, persistent authentication and automatic screenshots are disabled.
CAPTCHA, OTP and payment remain user handoffs.
Site access can still fail; this project does not guarantee availability.

See [PLAN.md](PLAN.md) for remaining live authenticated verification, boarding/
contact automation, final review validation and automatic confirmation detection.
