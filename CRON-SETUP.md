# העברת ההפעלה ל-cron-job.org

GitHub לא מפעיל את התזמון של ה-repo הזה (0 הרצות מתוזמנות מאז 13.11.2026), ולכן שירות חיצוני וחינמי,
[cron-job.org](https://cron-job.org), יפעיל את הבוט ואת החיפוש. הוא שולח בקשה ל-GitHub בזמנים קבועים,
ו-GitHub מריץ את ה-workflow בדיוק כמו בהפעלה ידנית.

## מה כבר מוכן (בצד של ה-repo)

- הבוט (`bot.yml`) והחיפוש (`watch.yml`) מקבלים הפעלה חיצונית (workflow_dispatch), עם בחירת מצב לחיפוש (`check` / `summary`).
- אין כפילויות: אם גם התזמון של GitHub יתחיל לעבוד, הרצות לא ירוצו במקביל (concurrency), אז אין התראות כפולות.
  כל משתמש מקבל לכל היותר סיכום יומי אחד ב-20 שעות, לא משנה מי הפעיל את הריצה. ‏(התזמון של GitHub התעורר בלילה
  של 14.11 באופן ספורדי, ולכן זה חשוב.)
  את התזמון של GitHub משאירים כגיבוי.
- **בדיקה רק על האדמין:** `"user":"admins"` מריץ את החיפוש רק על האדמין (בעל הבוט), ומשתמשים רגילים לא מקבלים שום הודעה.
  אותו מנגנון משמש גם לבדיקת שינויים עתידיים לפני שהם מגיעים לכולם.
- בדיקה שההפעלות מגיעות בזמן: `node tools/check-schedule.js 6` (6 השעות האחרונות; מספר ההרצות לפי מקור והפער הכי גדול).
- יומן כשלים: `/errors` בבוט (רק לבעלים).

## שני שלבים: קודם רק עליך

- **שלב א׳ (בדיקה):** החיפוש והסיכום רצים **רק על האדמין (אתה)**, עם `"user":"admins"` בגוף הבקשה.
  משתמשים רגילים לא מקבלים שום הודעה. הבוט עונה רק למי ששולח לו הודעה, כמו תמיד.
- **שלב ב׳ (לכולם):** אחרי שבדקנו שהכל עובד אצלך, מוחקים את `"user":"admins"` משתי משימות החיפוש (צעד 16).

## שלוש המשימות שצריך ליצור

| משימה | כתובת (URL) | מתי | גוף הבקשה (Request body) |
|---|---|---|---|
| בוט | `https://api.github.com/repos/mrTal77/flight-bot/actions/workflows/bot.yml/dispatches` | כל 5 דקות | `{"ref":"main"}` |
| חיפוש | `https://api.github.com/repos/mrTal77/flight-bot/actions/workflows/watch.yml/dispatches` | כל 4 שעות, בדקה 17 | שלב א׳: `{"ref":"main","inputs":{"mode":"check","user":"admins"}}` |
| סיכום יומי | `https://api.github.com/repos/mrTal77/flight-bot/actions/workflows/watch.yml/dispatches` | כל יום ב-07:41 (שעון ישראל) | שלב א׳: `{"ref":"main","inputs":{"mode":"summary","user":"admins"}}` |

בשלב ב׳ גוף הבקשה של החיפוש הוא `{"ref":"main","inputs":{"mode":"check"}}`, ושל הסיכום `{"ref":"main","inputs":{"mode":"summary"}}`.

בכל שלוש המשימות: שיטה `POST`, ואותן ארבע כותרות (headers):

| Header | Value |
|---|---|
| `Authorization` | `Bearer ` ואחריו המפתח (מתחיל ב-`github_pat_`) |
| `Accept` | `application/vnd.github+json` |
| `X-GitHub-Api-Version` | `2022-11-28` |
| `Content-Type` | `application/json` |

תשובה תקינה מ-GitHub: **204** (בלי תוכן).

---

## הצעדים שלך (בערך 15 דקות)

### שלב 1: מפתח הרשאה ב-GitHub (5 דקות)

1. [ ] נכנסים ל-github.com, תמונת הפרופיל למעלה מימין, **Settings**.
2. [ ] בתפריט משמאל, למטה: **Developer settings**, אחר כך **Personal access tokens**, ואז **Fine-grained tokens**.
3. [ ] **Generate new token**, וממלאים:
   - **Token name:** `flight-bot cron`
   - **Resource owner:** `mrTal77`
   - **Expiration:** הכי ארוך שמאפשרים (שנה). לרשום ביומן תזכורת לחדש שבוע לפני.
   - **Repository access:** **Only select repositories**, ובוחרים רק את **flight-bot**.
   - **Permissions**, ואז **Repository permissions**, ואז **Actions:** **Read and write**.
     שום הרשאה אחרת. ‏(Metadata: Read-only נוסף לבד, זה תקין.)
4. [ ] **Generate token**, ואז מעתיקים את המפתח ושומרים אותו בצד לרגע (הוא מוצג פעם אחת בלבד).
   - ⚠️ לא להדביק אותו בצ׳אט, בקוד או בשום מקום אחר חוץ מ-cron-job.org.
   - מה המפתח יכול לעשות: רק להפעיל או לעצור הרצות ב-flight-bot. הוא לא יכול לקרוא סודות, לשנות קוד או לגשת ל-repo אחר.

### שלב 2: חשבון ב-cron-job.org (2 דקות)

5. [ ] נרשמים בחינם ב-[cron-job.org](https://console.cron-job.org/signup) ומאשרים את המייל.
6. [ ] בהגדרות החשבון (Settings) קובעים **Timezone: Asia/Jerusalem**.

### שלב 3: המשימה הראשונה, הבוט (3 דקות)

7. [ ] **Create cronjob**, ובלשונית **Common**:
   - **Title:** `flight-bot: bot`
   - **URL:** הכתובת של "בוט" מהטבלה למעלה
   - **Execution schedule:** **Every 5 minutes**
8. [ ] בלשונית **Advanced**:
   - **Request method:** `POST`
   - **Request headers:** ארבע הכותרות מהטבלה (Add header לכל אחת)
   - **Request body:** `{"ref":"main"}`
9. [ ] בלשונית **Notifications** (אם יש): מסמנים **Notify me when an execution fails**. כך תקבל מייל אם המפתח יפוג.
10. [ ] **Save**, ואז **Test run** (או **Run now**). צריך לראות **204**.
    - 401: המפתח שגוי, או שחסרה המילה `Bearer ` לפני המפתח.
    - 403: לא נבחרה הרשאת **Actions: Read and write**, או שלא נבחר ה-repo **flight-bot**.
    - 404: יש טעות בכתובת.
    - 422: יש טעות בגוף הבקשה. מעתיקים אותו שוב מהטבלה.
11. [ ] בודקים שזה עובד: ב-GitHub, בלשונית **Actions**, ואז **telegram-bot**, מופיעה הרצה חדשה. שולחים לבוט `/status` ומקבלים תשובה תוך 5 דקות.

### שלב 4: שתי המשימות של החיפוש (3 דקות)

12. [ ] במשימה הראשונה: **⋯**, ואז **Clone** (או יוצרים חדשה עם אותן כותרות).
    - **Title:** `flight-bot: search`
    - **URL:** הכתובת של "חיפוש" מהטבלה
    - **Execution schedule:** Custom: דקה `17`, שעות `0,4,8,12,16,20`, כל יום
    - **Request body:** `{"ref":"main","inputs":{"mode":"check","user":"admins"}}`
13. [ ] שוב **Clone**:
    - **Title:** `flight-bot: daily summary`
    - **URL:** אותה כתובת של "חיפוש"
    - **Execution schedule:** כל יום ב-`07:41`
    - **Request body:** `{"ref":"main","inputs":{"mode":"summary","user":"admins"}}`
14. [ ] **Test run** לשתיהן: 204. בשלב א׳ זה שולח הודעות רק לך.

### שלב 5: לעדכן אותי

15. [ ] לכתוב לי "סיימתי". אני אבדוק עם `tools/check-schedule.js` ועם `/errors` שההפעלות מגיעות כל 5 דקות, שהחיפושים רצו
    **רק עליך**, ושאין כשלים.

### שלב 6: לפתוח לכולם (אחרי האישור שלי)

16. [ ] בשתי משימות החיפוש (`search` ו-`daily summary`) מוחקים מגוף הבקשה את `,"user":"admins"`.
    - חיפוש: `{"ref":"main","inputs":{"mode":"check"}}`
    - סיכום: `{"ref":"main","inputs":{"mode":"summary"}}`
    - לא לעשות Test run לסיכום בשלב הזה, כי זה ישלח סיכום נוסף לכל המשתמשים. מחכים ל-07:41.

---

## אחרי ההעברה

- **התזמון של GitHub נשאר כגיבוי.** אם הוא יתחיל לעבוד, לא יהיו כפילויות.
- **המפתח פג אחרי שנה.** cron-job.org ישלח מייל על כשלים (401). מחדשים את המפתח ב-GitHub ומעדכנים את ה-header בשלוש המשימות.
- **לעצור הכל:** משביתים את שלוש המשימות ב-cron-job.org (Disable), או מוחקים את המפתח ב-GitHub.
- **עלות:** אין. ה-repo ציבורי, אז דקות ה-Actions לא מוגבלות, ו-cron-job.org חינמי.
