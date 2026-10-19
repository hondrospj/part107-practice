# Part 107 Practice

Two original UAG practice exams with automatic grading, FAA chart figures, a two-hour timer, and answer review.

## Take an exam

Open [Part 107 Practice](https://hondrospj.github.io/part107-practice/), choose Exam A or B, and press **Begin exam**. Each form contains 60 scored questions and five unscored practice questions. The five unscored items are identified only after submission. The exam is graded on the 60 scored questions: **42 correct is 70%, a practice pass**.

Answers and the deadline save in the current browser. Closing or refreshing the page does not stop the timer. Results show every missed answer, an explanation, primary reference links, and a topic breakdown. **Copy results** produces a short report to paste into the chat; **Download results** saves the complete attempt as JSON.

The forms follow the current PSI scored-question allocation, rounded to whole items: regulations 29, airspace 12, weather 3, loading and performance 1, operations 15. The extra questions simulate the pacing of the unscored-item format; they are original practice questions, not actual FAA validation items.

## Real-test requirements

- Current UAG format: 60 scored plus five unscored questions, 120 minutes, 70% passing score.
- Obtain an FAA Tracking Number through IACRA and schedule **Unmanned Aircraft General – Small (UAG)** through PSI.
- Bring acceptable current identification and any required residential-address proof. The exam fee is approximately $175; confirm the booking amount with PSI.
- No preparatory course completion or instructor endorsement is required. Minimum knowledge-test age is 14; certificate eligibility begins at 16.
- After failing, the retest waiting period is 14 days. Passing is followed by an IACRA certificate application and TSA review.
- A same-day test depends on a confirmed PSI appointment. This project does not reserve or verify appointment availability.
- Starting October 26, 2026, UAG includes chart images absent from the printed test supplement. The included historical FAA figures are for training and are not current navigation charts.

Primary references, checked October 19, 2026:

- [PSI UAG Applicant Information Bulletin](https://media.psiexams.com/faa/UAG_Information_Bulletin.pdf)
- [FAA testing matrix and identification rules](https://www.faa.gov/training_testing/testing/testing_matrix)
- [FAA certification process](https://www.faa.gov/uas/commercial_operators/become_a_drone_pilot)
- [IACRA](https://iacra.faa.gov/) and [PSI scheduling](https://faa.psiexams.com/faa/login)
- [FAA fee information](https://www.faa.gov/faq/how-much-does-it-cost-get-remote-pilot-certificate)
- [FAA September 2026 testing advisory](https://www.faa.gov/training_testing/testing/September_2026_Special_Edition.pdf)

## Limits and privacy

This is independent practice, not an FAA or PSI exam. A practice pass does not issue a certificate or guarantee an official-test result. An 85% study target is a preparation buffer chosen for this app, not an FAA requirement. Repeating a form can inflate your score through familiarity; use the other form for a fresh check.

There is no backend, account, analytics, or score upload. Answers and scores remain in browser local storage unless the user chooses to copy or download them. GitHub Pages receives ordinary requests to serve site files; external reference sites receive a visit when a user opens their links. The app retains up to 12 completed attempts in local storage. The active timer is based on the device clock and is intended for practice, not secure proctoring.

## Run locally

Serve the directory with any static HTTP server, for example:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. A server is required because browsers restrict loading JSON from `file://` pages.

Run the tests with a current Node.js installation:

```sh
npm test
npm run check
```

## Content and figures

Question records, source references, figure provenance, and the blueprint are in `data/`. Questions and explanations were written for this project and checked against the cited primary material. Chart images are reproduced from the FAA’s public-domain testing supplement and retain attribution. Third-party linked documents remain owned by their respective publishers. No endorsement by the FAA, PSI, or any chart publisher is implied.
