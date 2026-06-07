package parser

import "testing"

// TestEpochMinutosUTC valida contra el ejemplo documentado en GestorDatos.java:
// 2025-08-18 10:30 local GMT+2 → 08:30 UTC = 29 258 430 min epoch.
func TestEpochMinutosUTC(t *testing.T) {
	got := EpochMinutosUTC(2025, 8, 18, 10, 30, 2)
	const want = 29_258_430
	if got != want {
		t.Errorf("EpochMinutosUTC = %d; quiero %d", got, want)
	}
}

func TestEpochMinutosUTC_Lima(t *testing.T) {
	// Lima GMT-5: 2026-07-20 08:15 local → 13:15 UTC.
	// epochDay(2026-07-20) * 1440 + 8*60+15 + 5*60
	got := EpochMinutosUTC(2026, 7, 20, 8, 15, -5)
	// local = epochDay*1440 + 495 ; UTC = local - (-5)*60 = local + 300
	day := EpochMinutosUTC(2026, 7, 20, 0, 0, 0) // 00:00 UTC ese día (gmt 0)
	want := day + 8*60 + 15 + 5*60
	if got != want {
		t.Errorf("Lima = %d; quiero %d", got, want)
	}
}

func TestDeadlineUTC(t *testing.T) {
	if d := DeadlineUTC(1000, 1, 1); d != 1000+1440 {
		t.Errorf("mismo continente = %d; quiero %d", d, 1000+1440)
	}
	if d := DeadlineUTC(1000, 1, 3); d != 1000+2880 {
		t.Errorf("distinto continente = %d; quiero %d", d, 1000+2880)
	}
}
