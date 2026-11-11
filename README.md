# Gemini & Google Workspace Workshop — registration site

Students register, sign in and book one session for their college (400 seats each).
Postgraduates can also book one GRASAG session. Staff sign in on a separate link to see
registrations, download lists and manage staff roles.

- **Hosting:** Vercel (website + two small server functions)
- **Database & sign-in:** Supabase (PostgreSQL + Auth)

| Link | Who |
| --- | --- |
| `https://<your-site>.vercel.app/` | Students: register, sign in, choose a session |
| `https://<your-site>.vercel.app/staff` | Staff: super admins, organisers, college coordinators |

## What's in this folder

```
index.html            The whole website (student + staff screens)
api/config.js         Gives the browser the public Supabase settings
api/staff.js          Super-admin staff management (create / edit / remove staff)
supabase/schema.sql   Database tables, sessions, seat-limit rules and access rules
package.json          Tells Vercel to install the Supabase library for api/staff.js
vercel.json           Makes /staff open the staff portal
```

---

## Step 1: Set up Supabase (about 10 minutes)

1. Go to **supabase.com**, sign in and click **New project**. Pick a name, a strong database
   password and the region closest to Ghana (for example *West EU* or *South Africa*).
2. When the project is ready, open **SQL Editor → New query**, paste the whole of
   `supabase/schema.sql` and click **Run**. This creates the tables, the 28 sessions and the
   rules that stop a session going over 400 seats.
3. Open **Authentication → Sign In / Providers → Email** and check that Email is enabled.
   - **Confirm email:** turn this **off** so students can choose a session straight after
     registering. If you leave it on, every student must click a link in their inbox before signing in.
4. Open **Authentication → URL Configuration**:
   - **Site URL:** your Vercel address, e.g. `https://gemini-workshop.vercel.app`
     (you can come back and set this after Step 2).
   - **Redirect URLs:** add the same address.
5. **Email sending (important):** Supabase's built-in email is only meant for testing and
   sends very few emails per hour. Password-reset emails will stop arriving once lots of students use them.
   Go to **Authentication → Emails → SMTP Settings** and connect a real email service
   (for example Resend, Brevo or your institution's mail server).
6. Open **Project Settings → API** (or **API Keys**) and copy three values for Step 2:
   - **Project URL**
   - **anon / publishable** key (safe to use in the browser)
   - **service_role / secret** key (**keep private**; it only goes into Vercel)

## Step 2: Put the site on Vercel (about 10 minutes)

1. Create a new repository on **GitHub** and upload everything in this folder
   (keep the `api` and `supabase` folders as they are).
2. Go to **vercel.com → Add New → Project**, import that repository.
   Framework preset: **Other**. Leave the build settings empty.
3. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project URL from Supabase |
   | `SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |

4. Click **Deploy**. When it finishes, copy your site address and put it into Supabase's
   **Site URL** and **Redirect URLs** (Step 1.4).

If you later change an environment variable, redeploy (Deployments → ⋯ → Redeploy).

## Step 3: Create your super admin account

1. In Supabase go to **Authentication → Users → Add user → Create new user**.
   Enter your email and a password, and tick **Auto Confirm User**.
2. In **SQL Editor**, run this with your own name and email:

   ```sql
   insert into public.staff (user_id, name, email, role)
   select id, 'Your Name', email, 'super' from auth.users where email = 'you@example.com';
   ```

3. Open `https://<your-site>.vercel.app/staff` and sign in. Under **Staff & roles** you can
   now add organisers and college coordinators. Each gets an email and password you choose.

## Roles

| Role | Can do |
| --- | --- |
| Super admin | Everything: all registrations, CSV downloads, session meeting links and sending them, add/edit/remove staff |
| Organiser | All registrations, CSV downloads, session meeting links and sending them |
| College coordinator | Registrations for their own college only |

The database enforces these rules, so a coordinator can never load another
college's students, even with technical tricks.

## How seats are protected

- Booking goes through a database function that locks the session while it counts seats.
  When the last seat goes, everyone else gets "That session has just filled up".
- A student can hold **one college session** and, if postgraduate, **one GRASAG session**.
  Clashing times are blocked.
- Students only see and can only book the sessions for their own college.

## Getting ready for heavy traffic (do this before you share the link)

Vercel and Supabase spread the load automatically, so you don't need to set up a load balancer.
The limits that matter are in Supabase:

1. **Sign-in rate limits (most important on campus).** Supabase limits how many sign-ups and
   sign-ins can come from one IP address. On campus Wi-Fi or in a computer lab, hundreds of
   students share the same public IP and will start seeing "Too many attempts". Go to
   **Authentication → Rate Limits** and raise the sign-up and sign-in limits for registration week.
2. **Email.** Supabase's built-in sender (password resets) is for testing only; see Email setup below.
3. **Plan.** Free projects are paused after a period of no activity and run on the smallest
   database. For the registration window and the event days, use the Pro plan. Under **Project
   Settings → Compute** you can temporarily pick a larger size and scale back afterwards.
4. **Test it once yourself:** register a test student, book, switch and cancel, and sign in at
   `/staff` before launch.

What the code already does to stay fast:

- Seat counts come from a counter column on each session (28 rows), not by counting thousands of
  bookings on every page refresh.
- Each open page checks seat counts about every 30–40 seconds (randomised so pages don't all
  hit at once) and stops checking while the tab is in the background.
- Booking locks only the session being booked (and the one being left), in a fixed order, so
  students booking different sessions never wait for each other and seat swaps can't deadlock.
- Access rules are written so Supabase evaluates them once per request, not once per row.
- `/api/config` is cached at Vercel's edge, so page loads don't each start a server function.

## Common tasks

- **Download attendee lists:** Staff portal → Registrations → **Download CSV**.
- **A student forgot their password:** they click **Forgot your password?** on the sign-in
  page and get a reset link by email.
- **Add the Google Meet link for a session:** Staff portal -> Registrations -> **View list** on the
  session -> **Meeting link**. Paste the link and click **Save link**. Super admins and organisers only.
- **Send the link to everyone booked on a session:** on that session's page click
  **Send link to booked students** and confirm (it shows how many go by email and how many by SMS).
  You can press it again after changing a link.
  Big classes are sent through a queue in batches of 50 with a progress bar, so nothing times out
  (keep the page open until it says Finished). If it is interrupted, press **Resume sending**;
  messages that failed can be sent again with **Retry failed**, and nobody gets the same message twice.
  The daily job also finishes any broadcast left half-sent.
  Students also get a welcome message when they register, a confirmation when they book and a reminder the day before (daily job at 08:00 Ghana time).

## How messages reach students: email or SMS

Each student gets **email** if they registered with a public mailbox they read on their phone
(Gmail, Yahoo, Outlook/Hotmail/Live, iCloud, AOL, Proton) and **SMS** otherwise: student and school
addresses (`@st.knust.edu.gh`, `@knust.edu.gh`, …), work addresses and typos such as `gmail.comm`.
A student whose email bounces or who reports it as spam is switched to SMS automatically.
The rule lives in `api/_send.js`; to change the list without editing code, set `EMAIL_DOMAINS`
(comma list, for example `gmail.com,yahoo.com,icloud.com`) in Vercel. Staff see an **Email** / **SMS**
tag next to each student, and **Bounced** / **Spam report** when an address is bad.

To see the split for the current students (read-only, sends nothing):

```
set -a; . ./.env; set +a; node tools/channel-report.js
```

## Email setup (Amazon SES, from your own domain)

Emails come from `workshop@kecworkshops.com` through Amazon SES (about $0.10 per 1,000 emails).
Use region **eu-west-1 (Ireland)** throughout. DNS records go in **Cloudflare -> kecworkshops.com -> DNS**,
always as **DNS only (grey cloud)**.

1. **AWS Billing -> Budgets:** create a $2 monthly budget alert, so nothing can surprise you.
2. **SES -> Identities -> Create identity -> Domain** `kecworkshops.com`, Easy DKIM, RSA 2048.
   Add the **3 CNAME** records it shows in Cloudflare. The identity turns *Verified* within minutes to an hour.
3. On that identity, **Custom MAIL FROM domain** `mail.kecworkshops.com`, then add in Cloudflare:
   - `MX mail -> feedback-smtp.eu-west-1.amazonses.com` (priority 10)
   - `TXT mail -> v=spf1 include:amazonses.com ~all`
4. **DMARC:** `TXT _dmarc -> v=DMARC1; p=none; rua=mailto:workshop@kecworkshops.com`.
   After a week with no problems change `p=none` to `p=quarantine`.
5. **Replies:** Cloudflare -> Email -> **Email Routing**: forward `workshop@kecworkshops.com` to your Gmail (free).
6. **Leave the sandbox:** SES -> Account dashboard -> **Request production access**. Type: Transactional.
   Describe it as: registration and joining-link emails for a university workshop, sent only to students who
   registered on the site themselves; bounces and complaints are handled automatically (the address is
   switched off and the student gets SMS instead). Until approved, SES only delivers to addresses you verify
   yourself, which is fine for testing.
7. **SES -> SMTP settings -> Create SMTP credentials.** Save the username and password (this is not your AWS access key).
8. **Supabase SQL Editor:** run `supabase/migrations/007_email.sql` **before** deploying the new code.
9. **Vercel -> Settings -> Environment Variables** (add them **after** production access is approved, then redeploy):

   | Name | Value |
   | --- | --- |
   | `SMTP_HOST` | `email-smtp.eu-west-1.amazonaws.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` / `SMTP_PASS` | the SMTP credentials from step 7 |
   | `MAIL_FROM` | `Gemini Workshop <workshop@kecworkshops.com>` |
   | `SES_EVENTS_SECRET` | any long random text |

10. **Bounce and complaint feedback** (after the deploy): **SNS -> Topics -> Create topic** (Standard, e.g. `ses-events`),
    then **Create subscription**: protocol HTTPS, endpoint `https://<your site>/api/mail-events?key=<SES_EVENTS_SECRET>`.
    It confirms itself within seconds. Then **SES -> your identity -> Notifications -> Edit**: send **Bounce** and
    **Complaint** to that topic. Optionally set `SES_TOPIC_ARN` in Vercel so only that topic is accepted.
11. **Check it:** send yourself a message, open it in Gmail -> ⋮ -> **Show original** and confirm SPF, DKIM and DMARC say **PASS**.

While the `SMTP_*` settings are missing, everyone gets SMS as before.

## SMS setup (mNotify, for school addresses and bounced emails)

1. Log in at **mnotify.com**, top up your SMS credits and copy your API key (Developers / API).
2. Register a **Sender ID** in the mNotify dashboard (a name of up to 11 characters, for example `GeminiWksp`; it is not a phone number). Approval can take a day or two; until then `mNotify` is used.
3. Add these in Vercel -> Settings -> Environment Variables (and in `.env` for local use), then redeploy:

   | Name | Value |
   | --- | --- |
   | `MNOTIFY_API_KEY` | the key from mNotify |
   | `MNOTIFY_SENDER` | your approved Sender ID (optional) |
   | `CRON_SECRET` | any long random text (Vercel sends it with the daily reminder job) |

4. Run these files once, in order, in the Supabase SQL Editor:
   `002_session_links_and_emails.sql`, `003_email_queue.sql`, `004_realtime.sql`, `005_realtime_students.sql`
   and `006_sms.sql` (all in `supabase/migrations/`; a brand-new project gets everything from `schema.sql` instead).
   Then `007_email.sql` (see Email setup). The tables `email_queue` and `email_log` hold both emails and texts.

Until `MNOTIFY_API_KEY` is set, students without a public mailbox get nothing (the rest still get email). One text is about 1 credit per
student per 160 characters; the messages are written to fit in one. Phone numbers must be Ghana numbers
(for example 024 123 4567); registration rejects anything else.
## Busy day checklist (hundreds of students at once)

The site is built to absorb a rush: the page and the session list/seat counts (`/api/catalog`) are served from Vercel's CDN
(counts refresh every 5 seconds, booking still checks real capacity in the database), pages retry briefly when the server is busy,
and the server functions limit floods (`/api/login`: 8 tries per student number per 10 minutes; messages: 6 calls a minute per student).

Do these before sharing the link:
1. **Supabase -> Authentication -> Rate Limits:** raise **"Sign-ups and sign-ins"** to about **1000** per 5 minutes (and raise "Token refreshes").
   This matters most: every sign-in reaches Supabase from Vercel's servers, and students on campus Wi-Fi share one address, so the default
   limit would block most of them.
2. **Wake the database:** a free Supabase project pauses after a week without use. Open the site (or the Supabase dashboard) the day before.
   For a very large event, Supabase Pro (about $25/month) gives more capacity and never pauses.
3. **mNotify:** keep some SMS credit for students with school addresses (`node tools/channel-report.js` shows how many). Check the SES sending quota in the SES Account dashboard.
4. **During the rush:** watch Supabase -> Reports (API requests, errors) and Vercel -> Observability. If the traffic looks like an attack,
   turn on **Vercel -> Firewall -> Attack Challenge Mode**.

When the site is busy, students see "Lots of students are using the site right now…" and the page retries by itself; they do not need to refresh.

- **See raw data:** Supabase → Table Editor → `students`, `bookings`, `staff`.
- **Change session times, titles or capacity:** edit the `sessions` table in Supabase (Table Editor -> `sessions`:
  `starts_at`, `ends_at`, `title`, `capacity`). The website reads the list from the database when it opens, so there is
  nothing to change in `index.html`. Times are stored in GMT, which is Ghana time. Keep `day_key` as `d1`, `d2`, `d3`
  (one per day) and `slot` as the order of the session within the day.
- **Before launch, start fresh:** re-running `schema.sql` wipes all registrations and
  recreates everything. Do not re-run it once students have registered.
