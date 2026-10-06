"""Lay out scenes 2 to the end from the real voice durations. Writes timeline.json (marks + lines)."""
import json, sys
sys.path.insert(0, '.')
from lines import LINES
D = json.load(open('vo/durs.json'))
TXT = {l['id']: l for l in LINES}
T = [50.0]; M = {}; LN = {}
def mark(n): M[n] = round(T[0], 3)
def beat(n, d): mark(n); T[0] += d
def line(i, pre=.3, post=0.0):
    T[0] += pre; LN[i] = (round(T[0], 3), round(T[0]+D[i], 3)); M[i] = LN[i][0]; T[0] += D[i]+post
def over(i, at):
    LN[i] = (round(at, 3), round(at+D[i], 3)); M[i] = LN[i][0]; return LN[i][1]

# ---- scene 2: library, the note ----
mark('s2')
beat('thud', 2.4); beat('floorbook', 2.2); beat('pickup', 3.6)
beat('note', 3.0); over('a2_1', M['note']+.3)
beat('finger', 3.2); beat('smear', 2.4); beat('dried', 2.6)
beat('putback', 5.4); over('a2_2', M['putback']+.9)
# ---- scene 3: next day ----
mark('s3')
beat('enter', 4.6); beat('thuds', 3.4); beat('blink', 2.2)
beat('floorbooks', 4.8); over('a3_1', M['floorbooks']+.6)
beat('startwrite', 4.8); over('a3_2', M['startwrite']+.4)
beat('montage', 7.2); beat('answer', 3.2); beat('silence', 2.8)
beat('leave', 4.2); over('a3_3', M['leave']+1.2)
# ---- scene 4: corridor ----
mark('s4')
beat('walk', 4.6); beat('window', 2.6); beat('board', 3.0); beat('stop', 1.8)
beat('door', 4.2); e = over('a4_1', M['door']+.4)
beat('faster', max(2.5, e-T[0]+.6))
mark('cofer'); T[0] += .6
line('t4_1', .2); line('c4_1', .15); line('t4_2', .25); line('c4_2', .2)
beat('watch', .4); e = over('a4_2', M['watch']+.1); T[0] = e+1.0
# ---- scene 5: bedroom ----
mark('s5')
beat('bed', 1.0); e = over('a5_1', M['bed']+.6); T[0] = e+.8
beat('cold', 4.2); beat('reveal', 2.6)
line('b5_1', 0); line('o5_1', -.12, .2)
beat('stare', 1.6)
line('b5_2', .1); line('an5_1', .5); line('b5_3', .4); line('s5_1', .5); line('b5_4', .5)
beat('pause5', 1.4); line('o5_2', 0); line('b5_5', .5); line('an5_2', .4); line('b5_6', -.18)
beat('silence5', 2.2); line('an5_3', 0)
beat('bottle', 2.2); line('b5_7', 0); line('s5_2', .4); line('b5_8', .4)
beat('lean', .3); line('o5_3', .2); line('all5', .5)
beat('backaway', 1.2); line('s5_3', .1); beat('gone', 1.6); beat('warm', 1.4)
line('a5_2', .2); line('a5_3', .9, .9)
# ---- scene 6: rain ----
mark('s6')
beat('rainwalk', 1.4); line('a6_1', 0)
beat('atwindow', .5); line('a6_2', .1); line('a6_3', .9, .3)
beat('through', 3.2); beat('phone', 1.2); beat('dowieout', 3.6); beat('tealeft', 1.6); beat('musiccut', .2); beat('opendoor', 2.0)
# ---- scene 7: staffroom ----
mark('s7')
beat('st_enter', 3.4); beat('st_bottle', 3.2); beat('st_reach', 2.0); beat('st_cough', 2.6)
beat('st_drops', 3.8); beat('st_out', 3.2); beat('st_clock', 1.0); beat('st_sip', 3.4)
beat('st_look', 3.0); beat('st_drink', 3.4); over('a7_1', M['st_drink']+1.4)
T[0] = max(T[0], LN['a7_1'][1]+.6)
# ---- scene 8: black and white reprise ----
mark('s8'); beat('bw', 13.0)
# ---- scene 9: collapse ----
mark('s9'); beat('collapse', 2.6); beat('spread', 1.8); beat('dowiein', 3.0); beat('phonedrop', 1.8); beat('frozen', 3.2)
# ---- scene 10: Dr Anna ----
mark('s10'); beat('annaopen', 1.6)
line('n10_1', 0, .4); line('n10_2', .2, .3); line('n10_3', .3, .3); line('n10_4', .3, .5); line('n10_5', .3, .6)
beat('tilt', .5); line('n10_6', 0, .3)
beat('standup', .4); line('n10_7', .2, .4); line('n10_8', .2)
beat('sting', 1.8); line('n10_9', 0, .3)
beat('dip', 3.2); line('n10_10', .1, .3); beat('fold', 1.3); line('n10_11', .1, .3)
beat('lookbaden', 1.0); line('n10_12', 0, .3); beat('lookcam', 1.0); line('n10_13', 0, .6)
beat('shelf', 1.0); line('n10_14', 0, .5); beat('flicker', .45); beat('close', 1.6)
beat('black5', 5.0); line('n10_15', 0, .8)
beat('theend', 3.2); beat('credits', 24.0)
mark('END')
out = dict(end=round(T[0], 2), marks=M, lines=[dict(id=k, who=TXT[k]['who'], text=TXT[k]['text'], t0=v[0], t1=v[1]) for k, v in sorted(LN.items(), key=lambda kv: kv[1][0])])
json.dump(out, open('timeline.json', 'w'), indent=0)
print('end', out['end'])
for k in ('s2','s3','s4','s5','s6','s7','s8','s9','s10','theend','credits'): print(k, M[k])
