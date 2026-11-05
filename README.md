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
| Super admin | Everything: all registrations, CSV downloads, student password-reset emails, add/edit/remove staff |
| Organiser | All registrations, CSV downloads, student password-reset emails |
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
2. **Email.** Connect a real SMTP service (Step 1.5). The built-in sender is for testing only.
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
  page, or staff click **Send password reset** next to the student.
- **See raw data:** Supabase → Table Editor → `students`, `bookings`, `staff`.
- **Change session times or capacity:** the website's session list is defined in `index.html`
  and in the `sessions` table. Both need to match, so change them together.
- **Before launch, start fresh:** re-running `schema.sql` wipes all registrations and
  recreates everything. Do not re-run it once students have registered.
