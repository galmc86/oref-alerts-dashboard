const CONFIG = {
  PROXY_URL: '/api/alerts',
  HISTORY_URL: '/api/history',
  POLL_INTERVAL_MS: 15000,
  HISTORY_LOOKBACK_MS: 30 * 60 * 1000, // 30 minutes
  WEBHOOK_URL: '',                      // loaded from localStorage at runtime
  EVENT_LOG_MAX: 200,                   // max event log entries in localStorage

  REGIONS: [
    { id: 1,  name: 'telaviv',          cityId: 24, displayName: 'תל אביב-יפו',        displayNameEn: 'Tel Aviv',         orefArea: 'תל אביב - יפו | אזור דן',            orefAreaEn: 'Tel Aviv - Jaffa | Dan Area',            matchPatterns: ['תל אביב'] },
    { id: 2,  name: 'beersheva',         cityId: 51, displayName: 'באר שבע',             displayNameEn: 'Beer Sheva',       orefArea: 'באר שבע | אזור מרכז הנגב',            orefAreaEn: 'Beer Sheva | Central Negev',             matchPatterns: ['באר שבע'] },
    { id: 3,  name: 'haifa',             cityId: 47, displayName: 'חיפה',                displayNameEn: 'Haifa',            orefArea: 'חיפה | אזור המפרץ',                   orefAreaEn: 'Haifa | Bay Area',                       matchPatterns: ['חיפה'] },
    { id: 5,  name: 'jerusalem',         cityId: 49, displayName: 'ירושלים',             displayNameEn: 'Jerusalem',        orefArea: 'ירושלים | אזור ירושלים',               orefAreaEn: 'Jerusalem | Jerusalem Area',             matchPatterns: ['ירושלים'] },
    { id: 6,  name: 'nathanya',          cityId: 14, displayName: 'נתניה',               displayNameEn: 'Netanya',          orefArea: 'נתניה | אזור שרון',                    orefAreaEn: 'Netanya | Sharon Area',                  matchPatterns: ['נתניה'] },
    { id: 7,  name: 'rishonlezion',      cityId: 19, displayName: 'ראשון לציון',         displayNameEn: 'Rishon LeZion',    orefArea: 'ראשון לציון | אזור השפלה',             orefAreaEn: 'Rishon LeZion | Shfela Area',            matchPatterns: ['ראשון לציון'] },
    { id: 8,  name: 'bikatpetah',        cityId: 17, displayName: 'פתח תקווה',           displayNameEn: 'Petah Tikva',      orefArea: 'פתח תקווה | אזור דן',                 orefAreaEn: 'Petah Tikva | Dan Area',                 matchPatterns: ['פתח תקווה'] },
    { id: 9,  name: 'hodhasharon',       cityId: 7,  displayName: 'הוד השרון',           displayNameEn: 'Hod HaSharon',     orefArea: 'הוד השרון | אזור שרון',                orefAreaEn: 'Hod HaSharon | Sharon Area',             matchPatterns: ['הוד השרון'] },
    { id: 10, name: 'herzliyaramathas',  cityId: 9,  displayName: 'הרצליה',              displayNameEn: 'Herzliya',         orefArea: 'הרצליה | אזור דן',                    orefAreaEn: 'Herzliya | Dan Area',                    matchPatterns: ['הרצליה'] },
    { id: 11, name: 'rehovot',           cityId: 20, displayName: 'רחובות',              displayNameEn: 'Rehovot',          orefArea: 'רחובות | אזור השפלה',                  orefAreaEn: 'Rehovot | Shfela Area',                  matchPatterns: ['רחובות'] },
    { id: 12, name: 'krayot',            cityId: 58, displayName: 'קריית ביאליק',        displayNameEn: 'Kiryat Bialik',    orefArea: 'קריית ביאליק | אזור המפרץ',            orefAreaEn: 'Kiryat Bialik | Bay Area',               matchPatterns: ['קריית ביאליק'] },
    { id: 13, name: 'ashdod',            cityId: 53, displayName: 'אשדוד',               displayNameEn: 'Ashdod',           orefArea: 'אשדוד | אזור השפלה',                   orefAreaEn: 'Ashdod | Shfela Area',                   matchPatterns: ['אשדוד'] },
    { id: 14, name: 'ramlelod',          cityId: 93, displayName: 'רמלה',                displayNameEn: 'Ramla / Lod',      orefArea: 'רמלה | אזור השפלה',                    orefAreaEn: 'Ramla | Shfela Area',                    matchPatterns: ['רמלה'] },
    { id: 15, name: 'hadera',            cityId: 90, displayName: 'חדרה',                displayNameEn: 'Hadera',           orefArea: 'חדרה | אזור מנשה',                     orefAreaEn: 'Hadera | Menashe Area',                  matchPatterns: ['חדרה'] },
    { id: 20, name: 'eilat',             cityId: 52, displayName: 'אילת',                displayNameEn: 'Eilat',            orefArea: 'אילת | אזור אילת',                    orefAreaEn: 'Eilat | Eilat Area',                     matchPatterns: ['אילת'] },
    { id: 21, name: 'modiin',            cityId: 30, displayName: 'מודיעין מכבים רעות',  displayNameEn: "Modi'in",          orefArea: 'מודיעין מכבים רעות | אזור ירושלים',    orefAreaEn: "Modi'in | Jerusalem Area",               matchPatterns: ['מודיעין'] },
    { id: 22, name: 'ashkelon',          cityId: 85, displayName: 'אשקלון',              displayNameEn: 'Ashkelon',         orefArea: 'אשקלון | אזור מערב לכיש',             orefAreaEn: 'Ashkelon | West Lachish Area',           matchPatterns: ['אשקלון'] },
    { id: 26, name: 'shoham',            cityId: 79, displayName: 'שוהם',                displayNameEn: 'Shoham',           orefArea: 'שוהם | אזור ירקון',                    orefAreaEn: 'Shoham | Yarkon Area',                   matchPatterns: ['שוהם'] },
    { id: 27, name: 'yokneam',           cityId: 63, displayName: 'יוקנעם המושבה',       displayNameEn: 'Yokneam',          orefArea: 'יוקנעם המושבה | אזור וואדי ערה',      orefAreaEn: 'Yokneam | Wadi Ara Area',                matchPatterns: ['יוקנעם', 'יקנעם'] },
  ]
};

if (typeof module !== 'undefined') module.exports = CONFIG;
