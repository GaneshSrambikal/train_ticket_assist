# IRCTC booking assistant

A Windows / TypeScript prototype for preparing General and Tatkal journeys.

**Status: booking automation discontinued.** Testing encountered HTTP 403 Access
Denied in Playwright-launched Chrome. IRCTC's terms also prohibit automation and
scripting software. Use normal Chrome for actual bookings.
[Official terms, page 7](https://contents.irctc.co.in/en/Terms%20and%20conditions.pdf#page=7).

Follow these steps to install the project, validate journey files and run local tests.

## Step 1: Install the requirements

You need Windows, **Node.js 24 or newer** (with npm), Git, and Google Chrome.

Open PowerShell and check:

```powershell
node --version
npm.cmd --version
git --version
```

If a command is missing, install Node.js or Git as needed and reopen PowerShell.

## Step 2: Fork or clone the repository

Open PowerShell in the folder where you want to keep the project. Choose one option:

**Option A — Clone the repository directly:**

```powershell
git clone https://github.com/GaneshSrambikal/train_ticket_assist.git
cd train_ticket_assist
```

**Option B — Fork it to your GitHub account, then clone your fork:**

1. Open [the repository](https://github.com/GaneshSrambikal/train_ticket_assist).
2. Click **Fork**, then **Create fork**.
3. On your fork, click **Code → HTTPS** and copy its clone URL.
4. Run the following commands, replacing `YOUR_GITHUB_USERNAME` with your username:

```powershell
git clone https://github.com/YOUR_GITHUB_USERNAME/train_ticket_assist.git
cd train_ticket_assist
```

These commands assume you kept the repository name `train_ticket_assist`. If you
renamed your fork, use its copied clone URL and folder name instead.

Continue with Step 3 inside the cloned folder containing `package.json`.
Run all remaining commands from that folder.

## Step 3: Install dependencies

```powershell
npm.cmd ci
```

Wait for installation to finish. No separate Playwright browser download is
needed: this project uses your installed Google Chrome.

## Step 4: Create a local journey file

For General quota:

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
if (!(Test-Path .local/journey.json)) {
    Copy-Item config/journey.general.example.json .local/journey.json
}
notepad .local/journey.json
```

This preserves an existing journey file. To start with Tatkal, replace the source
filename with `config/journey.tatkal.example.json` before creating the file.

Edit the fields in Notepad, then save:

| Field | What to enter |
| --- | --- |
| `quota` | `GENERAL` or `TATKAL` |
| `from`, `to` | Station codes, such as `LTT` and `ERS` |
| `boardingStation` | Your boarding station code |
| `journeyDate` | Boarding date in `YYYY-MM-DD` format |
| `trainOriginDate` | Required for Tatkal: date the train leaves its origin |
| `trainNumber` | Five-digit train number, inside quotes |
| `travelClass` | Class code, such as `3A`, `2A` or `SL` |
| `passengers` | Name, numeric age, gender (`M`, `F`, `T`) and berth preference |
| `maxFare` | Your maximum total fare in rupees, as a number |

Examples have fixed dates: update them before validating. Use synthetic passenger
names when just testing setup. Keep personal details in `.local/`, not `config/`.
JSON does not allow comments or trailing commas.

## Step 5: Validate the journey

```powershell
npm.cmd run validate -- .local/journey.json
```

Expected message: **Local format checks passed.** This does not open Chrome or
contact IRCTC. It checks file format and dates, not live availability or eligibility.

If it reports an error, edit the journey file and run the command again.

## Step 6: Check the installation

```powershell
npm.cmd run typecheck
npm.cmd test
```

`typecheck` should finish without errors. `test` should report passing tests.
Tests use local or intercepted browser fixtures and do not submit IRCTC bookings.
Setup is complete after these checks pass.

## Existing browser commands — reference only

The code remains available for investigation. These commands contact the live
site; local test results do not establish that live booking works.

| Command | What it does |
| --- | --- |
| `npm.cmd start` | Opens Chrome and checks the search form |
| `npm.cmd run check:live` | Checks the search page, then closes Chrome |
| `npm.cmd run prepare -- .local/journey.json` | Fills search fields without searching |
| `npm.cmd run search -- .local/journey.json` | Searches for the configured train |
| `npm.cmd run book -- .local/journey.json` | Legacy booking flow; not recommended for live use |
| `npm.cmd run diagnose` | Opens Chrome for manual investigation and records limited network metadata |

The legacy booking flow asks for `BOOK <train number>`, clicks Book Now, handles
optional login autofill, fills passengers and selects BHIM/UPI. **Continue is
currently manual.** CAPTCHA/OTP and final payment remain manual. Reliable booking
completion was not established.

Chrome normally stays open until you close it or press **Ctrl+C** in PowerShell.
Run only one assistant at a time.

## Optional login configuration

Credentials are unnecessary for setup, validation and local tests. The legacy
`book` command optionally reads `.local/credentials.json`:

```json
{
  "username": "your-irctc-username",
  "password": "your-irctc-password"
}
```

This is plaintext storage: never commit or share it. Without this file or environment
credentials, login stays manual. An existing empty file must be filled or removed
before `book` can run. A complete pair of `IRCTC_USERNAME` and `IRCTC_PASSWORD`
environment variables overrides the file.

## Common problems

| Problem | What to do |
| --- | --- |
| `npm` is not recognized | Install Node.js, then reopen PowerShell |
| PowerShell blocks `npm.ps1` | Use `npm.cmd`, as shown above |
| Chrome cannot be found | Install Google Chrome and retry the local tests |
| Journey date is in the past | Update `.local/journey.json` |
| Another run or lock exists | Close the other assistant or press Ctrl+C in its terminal; exited-process locks recover automatically |
| Pending booking attempt | Check booking and transaction history, then follow the instructions below |
| IRCTC returns 403 / Access Denied | Stop that attempt and use normal Chrome; repeated clicks or longer timeouts do not resolve the recorded denial |

To acknowledge a previous attempt, first close the assistant and verify there is
no unresolved booking or payment. Then run:

```powershell
npm.cmd run resolve-booking
```

Type `CHECKED` only after verifying the outcome. This clears the local guard;
it does not cancel a ticket, verify payment or retry a booking.

## Where files are stored

- `.local/`: private configuration, run locks and booking-attempt guard.
- `artifacts/`: run reports and diagnostic files.
- `config/`: example configuration files; keep them free of personal details.

`.local/` and `artifacts/` are ignored by Git. Diagnostic reports omit credentials,
request bodies, cookies and full URLs. Check any browser traces or network exports
for sensitive data before sharing them.
