"""Sky coordinates. Pure functions."""

from __future__ import annotations

import math

# Rotation from ICRS/J2000 equatorial to galactic Cartesian axes
# (x toward the Galactic Centre, y toward l = 90°, z toward the North Galactic Pole),
# as defined for the Hipparcos catalogue (ESA 1997, vol. 1, sect. 1.5.3).
_EQ_TO_GAL = (
    (-0.0548755604, -0.8734370902, -0.4838350155),
    (0.4941094279, -0.4448296300, 0.7469822445),
    (-0.8676661490, -0.1980763734, 0.4559837762),
)


def galactic_xyz_pc(
    ra_deg: float, dec_deg: float, distance_pc: float
) -> tuple[float, float, float]:
    """Heliocentric galactic Cartesian position in parsecs."""
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    eq = (
        math.cos(dec) * math.cos(ra) * distance_pc,
        math.cos(dec) * math.sin(ra) * distance_pc,
        math.sin(dec) * distance_pc,
    )
    x, y, z = (sum(row[i] * eq[i] for i in range(3)) for row in _EQ_TO_GAL)
    return x, y, z


def galactic_lb_deg(ra_deg: float, dec_deg: float) -> tuple[float, float]:
    """Galactic longitude and latitude in degrees."""
    x, y, z = galactic_xyz_pc(ra_deg, dec_deg, 1.0)
    return math.degrees(math.atan2(y, x)) % 360.0, math.degrees(math.asin(max(-1.0, min(1.0, z))))
