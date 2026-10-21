# Putting EasyContract online as a private preview

This puts EasyContract on the internet as an **invite-only** app. There is one login, the EasyContract sign-in page, and it remembers you for 14 days on each device. New company accounts need a **sign-up code** that you choose; colleagues join through invite links from the Team page and never need the code. Without a sign-up code, nobody can create a new account. Nothing here has been deployed for you; these are the steps to do it yourself.

> **Before you start**
> - EasyContract is not a formal legal advisory tool, and the usage policy is still a draft. Have a lawyer review it before real customers use the app.
> - Use synthetic or permitted documents only during the preview. Files are **not encrypted at rest** yet (the encryption slot exists but is a placeholder).
> - Never put passwords or keys in the code or in a file you commit. Set them in the hosting dashboard as described below.

You need a free GitHub account with the `EasyContract-Claude` repository, and an account with **one** of the two hosts below.

---

## Option A: Render (simplest, free plan)

**Good to know:** Render's free plan has no permanent storage. Accounts and uploaded files are wiped whenever the service restarts or is redeployed, and it goes to sleep after 15 minutes of no use (the first visit afterwards takes about a minute). That is fine for showing the app to a few people; use Option B if you need data to stay.

1. Sign in at **render.com** and connect your GitHub account when asked.
2. Click **New** → **Blueprint**, and choose the `EasyContract-Claude` repository. Render reads the `render.yaml` file in the repository.
3. Render asks for a value for **SIGNUP_CODE**. Make up a code that is hard to guess (for example three random words joined by dashes, like `harbour-lantern-forty`) and enter it. You'll need it once, to create your company account.
4. Click **Apply**. The first build takes 5 to 10 minutes.
5. When it says **Live**, open the address Render shows (it ends in `onrender.com`).
6. Choose **Create a company account**, enter the sign-up code from step 3, read and accept the usage policy, and you're in.

To change the code later: **Dashboard** → your service → **Environment** → edit `SIGNUP_CODE` → **Save**. Render restarts the service.

### Already set up with the old browser password?

Earlier versions used a grey browser pop-up (`PREVIEW_PASSWORD`). To switch to invite-only:

1. In Render, open your service → **Environment**.
2. **Delete** `PREVIEW_PASSWORD`, and **add** `SIGNUP_CODE` with a code you choose.
3. Click **Save**, then **Manual Deploy** → **Deploy latest commit**.

Because the free plan wipes data on restart, create your company account again afterwards, using the sign-up code.

## Option B: Fly.io (keeps your data)

Fly needs a payment card on file, but a small preview like this usually costs little or nothing. It keeps data on a small storage volume.

1. Install the Fly command-line tool by following the steps at **fly.io/docs/flyctl/install**, then run `fly auth login` in a terminal.
2. Open `fly.toml` in the repository and change `app = "easycontract-preview-change-me"` to a unique name (letters, numbers and dashes). Change `primary_region` to the region closest to you if you like.
3. In a terminal, inside the repository folder, run these one at a time:
   ```bash
   fly apps create <the name you chose>
   fly volumes create easycontract_data --size 1 --region <your region>
   fly secrets set SIGNUP_CODE="<a code you choose>"
   fly deploy
   ```
4. Open `https://<the name you chose>.fly.dev`, choose **Create a company account**, and enter the sign-up code.

To change the code: `fly secrets set SIGNUP_CODE="<new code>"`.

---

## Optional: read scanned PDFs (OCR)

By default a scanned PDF is reported as "We couldn't read this document". To read scans on the server instead (nothing is sent anywhere else):

- **Render:** in the dashboard, under **Environment**, add `ENABLE_OCR` with the value `1`, save, then choose **Manual Deploy** → **Deploy latest commit**. (Render passes environment settings to the build.)
- **Fly:** deploy with `fly deploy --build-arg ENABLE_OCR=1`.

Passages read from a scan are marked "Read from a scan: check the wording" on screen and in every export.

## What the settings mean

| Setting | What it does | Where it is set |
|---|---|---|
| `SIGNUP_CODE` | Needed to create a new company account. Without it, sign-up is closed (invites still work). | Host dashboard or `fly secrets` only |
| `ALLOW_OPEN_SIGNUP=1` | Lets anyone with the address create an account, no code needed. Not recommended online. | Host dashboard |
| `OPEN_ACCESS=1` | **Temporary.** No sign-in at all: every visitor goes straight in and shares one "Open preview" company. Also skips `PREVIEW_PASSWORD`. A notice on every page warns not to upload real contracts. Delete it to restore sign-in. | Host dashboard |
| `PREVIEW_PASSWORD` | Optional extra: a browser password pop-up in front of the whole site. Leave it out for a single login. | Host dashboard or `fly secrets` only |
| `NODE_ENV=production` | Turns off the developer shortcut sign-in and requires secure cookies. | Already set in the config files |
| `DATA_DIR` | Where the database and uploaded files are kept. | Already set (`/data`) |
| `ENABLE_OCR` | Installs the OCR tools and switches on reading scanned PDFs locally. | Render environment, or `fly deploy --build-arg` (see above) |

## After it's running

- **Invite colleagues:** in the app, open **Team**, enter their email and role, and send them the link it shows. No emails are sent by the app. They don't need the sign-up code.
- **Staying signed in:** each device stays signed in for 14 days, unless you choose **Sign out**. On Render's free plan, a restart wipes accounts, so everyone signs up or is invited again.
- **Health check:** `/api/health` answers without signing in so the host can tell the app is running. It reveals nothing else.
- **Turning it off:** Render: **Settings** → **Suspend**. Fly: `fly scale count 0`.
