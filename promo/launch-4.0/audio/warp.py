"""The spot's retime (comp/warp.json): original edit times -> new times, and back."""
import json
import os

import numpy as np

_W = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'comp', 'warp.json')))
_OLD = np.array([p[0] for p in _W['points']], float)
_NEW = np.array([p[1] for p in _W['points']], float)
DURATION = float(_W['duration'])


def T(t):
    """New time of an event that was at `t` in the original edit."""
    return float(np.interp(t, _OLD, _NEW))


def old(t):
    """Original-edit time shown at new time `t`."""
    return float(np.interp(t, _NEW, _OLD))
