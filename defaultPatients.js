const DEFAULT_PATIENTS = [
  {
    id: "p1",
    name: "Patient A — Normal Bilateral",
    ears: {
      right: {
        tympType: "A",
        peakAdmittance: 0.95,
        TPP: -4,
        ECV: 1.40,
        gradient: 76,
        reflexShape: "symmetric",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: 80, 1000: 80, 2000: 85 }
        }
      },
      left: {
        tympType: "A",
        peakAdmittance: 0.63,
        TPP: 8,
        ECV: 1.35,
        gradient: 83,
        reflexShape: "symmetric",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: 80, 1000: 80, 2000: 85 }
        }
      }
    }
  },
  {
    id: "p2",
    name: "Patient B — Right Otosclerosis",
    ears: {
      right: {
        tympType: "As",
        peakAdmittance: 0.18,
        TPP: -8,
        ECV: 0.90,
        gradient: 28,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: null, 1000: null, 2000: null },
          contra: { 500: null, 1000: null, 2000: null }
        }
      },
      left: {
        tympType: "A",
        peakAdmittance: 0.82,
        TPP: -2,
        ECV: 1.25,
        gradient: 70,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: null, 1000: null, 2000: null }
        }
      }
    }
  },
  {
    id: "p3",
    name: "Patient C — Left Middle Ear Effusion",
    ears: {
      right: {
        tympType: "A",
        peakAdmittance: 0.88,
        TPP: -6,
        ECV: 1.30,
        gradient: 72,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: 85, 1000: 90, 2000: 95 },
          contra: { 500: null, 1000: null, 2000: null }
        }
      },
      left: {
        tympType: "B",
        peakAdmittance: 0.10,
        TPP: 0,
        ECV: 0.85,
        gradient: 0,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: null, 1000: null, 2000: null },
          contra: { 500: 85, 1000: 90, 2000: 95 }
        }
      }
    }
  },
  {
    id: "p4",
    name: "Patient D — Right Hypermobile (Type Ad)",
    ears: {
      right: {
        tympType: "Ad",
        peakAdmittance: 2.40,
        TPP: -18,
        ECV: 1.55,
        gradient: 160,
        reflexShape: "drifting",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: 80, 1000: 80, 2000: 85 }
        }
      },
      left: {
        tympType: "A",
        peakAdmittance: 0.70,
        TPP: -5,
        ECV: 1.28,
        gradient: 68,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: 80, 1000: 80, 2000: 85 }
        }
      }
    }
  },
  {
    id: "p5",
    name: "Patient E — Left Negative Pressure (Type C)",
    ears: {
      right: {
        tympType: "A",
        peakAdmittance: 0.75,
        TPP: -10,
        ECV: 1.20,
        gradient: 74,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: 80, 1000: 85, 2000: 90 }
        }
      },
      left: {
        tympType: "C",
        peakAdmittance: 0.55,
        TPP: -220,
        ECV: 1.18,
        gradient: 65,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: 95, 1000: 95, 2000: null },
          contra: { 500: 85, 1000: 85, 2000: 90 }
        }
      }
    }
  },
  {
    id: "p6",
    name: "Patient F — Right PE Tube (Type B, large ECV)",
    ears: {
      right: {
        tympType: "B",
        peakAdmittance: 0.08,
        TPP: 0,
        ECV: 2.30,
        gradient: 0,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: null, 1000: null, 2000: null },
          contra: { 500: 80, 1000: 80, 2000: 85 }
        }
      },
      left: {
        tympType: "A",
        peakAdmittance: 0.90,
        TPP: -3,
        ECV: 1.32,
        gradient: 78,
        reflexShape: "standard",
        reflexes: {
          ipsi:  { 500: 85, 1000: 85, 2000: 90 },
          contra: { 500: null, 1000: null, 2000: null }
        }
      }
    }
  }
];
