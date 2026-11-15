"""B13: every crop parameter carries a source or is an explicit estimate."""

from fastapi.testclient import TestClient

from app.main import app

PARAMS = {"kc", "stages", "topt", "heat", "nfix", "root", "ky", "ymax", "cost", "labour", "price"}


def test_every_parameter_has_a_source_or_is_an_estimate() -> None:
    rows = TestClient(app).get("/reference/crops").json()
    assert len(rows) >= 15
    for r in rows:
        assert set(r["params"]) == PARAMS
        for p in r["params"].values():
            assert p["source"] is None or (isinstance(p["source"], str) and p["source"].strip())
    cotton = next(r for r in rows if r["id"] == "cotton")
    assert cotton["params"]["kc"]["source"].startswith("FAO-56")
    assert cotton["params"]["heat"]["source"] is None  # the page shows «оценка»
