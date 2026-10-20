# Putting EasyContract online as a private preview

This puts EasyContract on the internet behind **one shared password**, so only people you give the password to can even see the sign-in page. Nothing here has been deployed for you; these are the steps to do it yourself.

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
3. Render asks for a value for **PREVIEW_PASSWORD**. Make up a long password (at least 16 characters, for example four random words) and enter it. This is the shared password for the whole site.
4. Click **Apply**. The first build takes 5 to 10 minutes.
5. When it says **Live**, open the address Render shows (it ends in `onrender.com`).
6. Your browser asks for a username and password. Type anything as the username and the password from step 3.
7. Choose **Create a company account**, read and accept the usage policy, and you're in.

To change the password later: **Dashboard** → your service → **Environment** → edit `PREVIEW_PASSWORD` → **Save**. Render restarts the service.

## Option B: Fly.io (keeps your data)

Fly needs a payment card on file, but a small preview like this usually costs little or nothing. It keeps data on a small storage volume.

1. Install the Fly command-line tool by following the steps at **fly.io/docs/flyctl/install**, then run `fly auth login` in a terminal.
2. Open `fly.toml` in the repository and change `app = "easycontract-preview-change-me"` to a unique name (letters, numbers and dashes). Change `primary_region` to the region closest to you if you like.
3. In a terminal, inside the repository folder, run these one at a time:
   ```bash
   fly apps create <the name you chose>
   fly volumes create easycontract_data --size 1 --region <your region>
   fly secrets set PREVIEW_PASSWORD="<a long password>"
   fly deploy
   ```
4. Open `https://<the name you chose>.fly.dev`, enter any username and the preview password, and create your company account.

To change the password: `fly secrets set PREVIEW_PASSWORD="<new password>"`.

---

## Optional: read scanned PDFs (OCR)

By default a scanned PDF is reported as "We couldn't read this document". To read scans on the server instead (nothing is sent anywhere else):

- **Render:** in the dashboard, under **Environment**, add `ENABLE_OCR` with the value `1`, save, then choose **Manual Deploy** → **Deploy latest commit**. (Render passes environment settings to the build.)
- **Fly:** deploy with `fly deploy --build-arg ENABLE_OCR=1`.

Passages read from a scan are marked "Read from a scan: check the wording" on screen and in every export.

## What the settings mean

| Setting | What it does | Where it is set |
|---|---|---|
| `PREVIEW_PASSWORD` | The shared password for the whole site. Leave it out and the site is open to anyone with the address. | Host dashboard or `fly secrets` only |
| `NODE_ENV=production` | Turns off the developer shortcut sign-in and requires secure cookies. | Already set in the config files |
| `DATA_DIR` | Where the database and uploaded files are kept. | Already set (`/data`) |
| `ENABLE_OCR` | Installs the OCR tools and switches on reading scanned PDFs locally. | Render environment, or `fly deploy --build-arg` (see above) |

## After it's running

- **Invite colleagues:** in the app, open **Team**, enter their email and role, and send them the link it shows. No emails are sent by the app. They also need the preview password.
- **Health check:** `/api/health` answers without the password so the host can tell the app is running. It reveals nothing else.
- **Turning it off:** Render: **Settings** → **Suspend**. Fly: `fly scale count 0`.
