"""The 86 s spot's musical cue sheet, shared by every soundtrack option.

Everything is on a 120 BPM grid (beat 0.5 s, bar 2 s, bar 1 starts at 0 s); every picture cut falls
on a beat. Times are seconds of the finished spot.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from warp import T  # noqa: E402  (original edit time -> spot time)

BPM = 120
BEAT = 0.5
BAR = 2.0
LENGTH = 86.0  # picture length; the mix fades over 84.4-86.6
DUR = 87.0  # render length for buffers


def bar_t(bar):
    """Start time of 1-based bar `bar`."""
    return (bar - 1) * BAR


# Sections as 1-based bar ranges (end exclusive), with what is on screen.
SECTIONS = [
    ('intro', 1, 5, 'Black, one tile icon glows (1.5 s); pull back as tiles light one per beat; widget on the desktop. Supers "Your home." / "Right on your desktop."'),
    ('drop', 5, 17, 'Impact + white flash at 8.0 on the 4.0 title; zoom through the 0; the redesign, frosted glass, live status, page motion, glowing icons, themes. The energetic main body.'),
    ('seasonal', 17, 23, 'Halloween (witch across the moon, 32-36), then eight-holiday montage, one cut per second 36-44 (New Year, Lunar New Year, Valentine, St Patrick, Easter, Thanksgiving, Christmas sleigh 42-44). Playful, festive colour (bells, sleigh jingles).'),
    ('features', 23, 29, 'Ctrl+K command palette (keycaps 44.0 and 44.75), typing, Enter dims the lights (47.75); Settings search and click. Focused, slightly pulled back but still moving.'),
    ('hook', 29, 35, 'Cloud Sync across three computers (56-62), desktop pins (62-65), Omarchy bar (65-68). The main melody / hook. Bar 34 (66-68) builds into the rapid cuts.'),
    ('rapid', 35, 39, 'Rapid feature cuts on every second 68-74 (camera, alarm, notifications, export, languages, hotkeys), then "And so much more." 74-76. Drums drop the very last beat (75.5-76.0) as a breath; harmony and a riser carry through it.'),
    ('finale', 39, 41, 'Finale impact at 76.0: widget and pins on the desktop, "Your whole home. / One glance away." The biggest moment.'),
    ('end', 41, 44, 'End-card impact at 80.0, app name and website; one final resolving chord that rings out to silence by 86.'),
]


def section(name):
    for s in SECTIONS:
        if s[0] == name:
            return range(s[1], s[2])
    raise KeyError(name)


DROP = 8.0  # the big hit on the title
FINALE = 76.0
ENDCARD = 80.0
HITS = (DROP, FINALE, ENDCARD)
BUILD_BAR = 34  # 66-68
BREATH = 75.5  # drums rest 75.5-76.0

# Tile icons lighting in the intro: one musical ping each (pick notes in your key, rising).
GLOW_TIMES = (1.5, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.25, 7.5)
# Accent colour cuts in the themes shot, and the holiday / rapid montage cuts.
ACCENT_CUTS = tuple(T(t) for t in (22.0, 22.5, 23.0, 23.5))  # 29.0, 29.75, 30.5, 31.25
HOLIDAY_CUTS = (36.0, 37.0, 38.0, 39.0, 40.0, 41.0, 42.0)  # 42.0-44.0 is Christmas (sleigh)
RAPID_CUTS = (68.0, 69.0, 70.0, 71.0, 72.0, 73.0, 74.0)  # 74.0 = "And so much more."
# Other section cuts inside the drop section (cards, status, pages, icons, themes):
DROP_CUTS = (10.0, 14.0, 17.0, 20.0, 23.0, 26.0)
