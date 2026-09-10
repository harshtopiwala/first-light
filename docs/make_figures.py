"""Generate documentation figures from the engine's own output.

Nothing here recomputes anything. tools/dump reads the model and writes
/tmp/figdata.json; this only draws it, so a figure can never disagree with
the number in the text.
"""
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle, FancyArrowPatch
from matplotlib.colors import LinearSegmentedColormap

D = json.load(open('/tmp/figdata.json'))
OUT = '/home/claude/first-light/docs/figures'

INK, INK2, INK3 = '#17181B', '#575C66', '#8B909B'
RULE, PAPER = '#E3DFD6', '#FCFBF8'
SUN, SHADE, SNOW = '#B45F1E', '#35506B', '#6E93B8'
RAMP = LinearSegmentedColormap.from_list('sun', ['#F3EDE3', '#E6CFA8', '#D3A461', '#B45F1E'])
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

plt.rcParams.update({
    'font.family': 'DejaVu Sans', 'font.size': 8.5,
    'axes.edgecolor': RULE, 'axes.labelcolor': INK2,
    'xtick.color': INK3, 'ytick.color': INK3,
    'figure.facecolor': 'white', 'axes.facecolor': 'white',
    'axes.spines.top': False, 'axes.spines.right': False,
})

SHORT = {'driveway': 'Driveway', 'front_walk': 'Front walk', 'deck': 'Rear deck',
         'back_yard': 'Back yard', 'side_yard_east': 'East side yard'}
COL = {'driveway': SUN, 'front_walk': '#D3A461', 'deck': SHADE,
       'back_yard': SNOW, 'side_yard_east': '#A9B7C4'}


def save(fig, name):
    fig.savefig(f'{OUT}/{name}.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print('wrote', name)


# ---------------------------------------------------------------- 1. pipeline
def pipeline():
    fig, ax = plt.subplots(figsize=(9.2, 3.4))
    ax.set_xlim(0, 100); ax.set_ylim(0, 42); ax.axis('off')

    def box(x, y, w, h, title, sub, edge, face='white'):
        ax.add_patch(Rectangle((x, y), w, h, ec=edge, fc=face, lw=1.4))
        ax.text(x + w / 2, y + h - 5.5, title, ha='center', va='center',
                fontsize=8.6, weight='bold', color=INK)
        for i, line in enumerate(sub):
            ax.text(x + w / 2, y + h - 11.5 - i * 4.6, line, ha='center', va='center',
                    fontsize=7.2, color=INK2)

    def arrow(x1, y1, x2, y2, colour=INK2, style='-|>', dashed=False):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style,
                                     mutation_scale=11, lw=1.1, color=colour,
                                     linestyle='--' if dashed else '-'))

    box(1, 22, 20, 18, 'Survey PDF', ['plot plan +', 'elevation set'], '#7FA05A')
    box(25, 22, 20, 18, 'Extraction', ['vector paths', 'assert vs sheet'], INK)
    box(49, 22, 20, 18, 'site.json', ['lot, footprint,', 'bearing, massing'], '#7FA05A')
    box(73, 22, 25, 18, 'Solar engine', ['NOAA / Meeus', 'validated to 10 s'], '#4E7DA8')

    box(25, 1, 22, 16, 'Horizon profiles', ['120 bearings', 'per 0.5 m cell'], '#4E7DA8')
    box(51, 1, 22, 16, 'Shading', ['sun hours,', 'insolation'], '#4E7DA8')
    box(77, 1, 21, 16, 'Melt model', ['energy balance', 'per cell'], '#C08A3E')
    box(1, 1, 20, 16, 'Open-Meteo', ['ERA5 daily,', 'no API key'], '#C08A3E')

    arrow(21, 31, 25, 31); arrow(45, 31, 49, 31); arrow(69, 31, 73, 31)
    arrow(85, 22, 47, 17)
    arrow(47, 9, 51, 9); arrow(73, 9, 77, 9)
    arrow(21, 9, 25, 9, '#C08A3E', dashed=True)
    ax.text(23, 12.5, 'weather', ha='center', fontsize=6.8, color='#C08A3E')
    ax.text(66, 19.5, 'sun position', ha='center', fontsize=6.8, color=INK3)
    save(fig, 'fig1_pipeline')


# ------------------------------------------------------------- 2. plan heatmap
def plan():
    fig, axes = plt.subplots(1, 2, figsize=(7.4, 6.4))
    lot, fp = D['lot'], D['footprint']
    for ax, key, title in zip(axes, ['dec', 'jun'], ['15 December', '15 June']):
        f = D[key]
        mx = max(f) or 1
        for (x, y), v in zip(D['cells'], f):
            ax.add_patch(Rectangle((x - .25, y - .25), .5, .5,
                                   fc=RAMP(v / mx), ec='none'))
        ax.add_patch(Rectangle((0, 0), lot['w'], lot['d'], fc='none', ec=INK3, lw=1.3))
        ax.add_patch(Polygon(fp, fc='#F5F2EC', ec=INK, lw=1.3))
        ax.text(lot['w'] / 2, 16, 'House', ha='center', fontsize=8, color=INK)
        ax.set_xlim(-1.2, lot['w'] + 1.2); ax.set_ylim(-1.2, lot['d'] + 1.2)
        ax.set_aspect('equal'); ax.axis('off')
        ax.set_title(f'{title}\nmax {mx:.1f} h', fontsize=9, color=INK, pad=8)
        ax.annotate('street', (lot['w'] / 2, -0.9), ha='center', fontsize=7.5, color=INK3)
    save(fig, 'fig2_plan_heatmap')


# ------------------------------------------------------------ 3. monthly hours
def monthly():
    fig, ax = plt.subplots(figsize=(8.4, 4.0))
    x = range(12)
    ax.plot(x, D['possible'], ls='--', lw=1.1, color='#C9C3B6', label='Daylight available')
    for k, v in D['monthly'].items():
        ax.plot(x, v, lw=1.9, color=COL[k], label=SHORT[k])
    ax.set_xticks(list(x)); ax.set_xticklabels(MONTHS)
    ax.set_ylabel('direct sun, hours per clear day')
    ax.set_ylim(0, 18); ax.grid(axis='y', color=RULE, lw=.7)
    ax.legend(frameon=False, fontsize=8, loc='upper left', ncol=2)
    save(fig, 'fig3_monthly_hours')


# --------------------------------------------------------------- 4. sweep
def sweep():
    fig, ax = plt.subplots(figsize=(8.4, 3.8))
    b = D['sweep']['bearings']
    ax.plot(b, D['sweep']['dec']['driveway'], color=SUN, lw=2, label='Driveway, December')
    ax.plot(b, D['sweep']['jun']['driveway'], color=SUN, lw=1.4, ls='--', label='Driveway, June')
    ax.plot(b, D['sweep']['dec']['back_yard'], color=SHADE, lw=2, label='Back yard, December')
    ax.plot(b, D['sweep']['jun']['back_yard'], color=SHADE, lw=1.4, ls='--', label='Back yard, June')
    ax.axvline(114.42, color=INK, lw=1)
    ax.text(118, 15.4, 'this lot, 114.42\u00b0', fontsize=8, color=INK)
    ax.set_xlabel('frontage bearing, degrees clockwise from true north')
    ax.set_ylabel('direct sun, hours')
    ax.set_xlim(0, 350); ax.set_ylim(0, 17)
    ax.set_xticks([0, 45, 90, 135, 180, 225, 270, 315])
    ax.grid(axis='y', color=RULE, lw=.7)
    ax.legend(frameon=False, fontsize=8, loc='lower right', ncol=2)
    save(fig, 'fig4_bearing_sweep')


# ------------------------------------------------------------------- 5. melt
def melt():
    fig, (ax, ax2) = plt.subplots(2, 1, figsize=(8.4, 4.6), sharex=True,
                                  gridspec_kw={'height_ratios': [2.4, 1]})
    dates = D['melt']['dates']
    idx = [i for i, d in enumerate(dates) if '2025-10-15' <= d <= '2026-05-15']
    xs = range(len(idx))
    for k in ['driveway', 'back_yard', 'deck']:
        ax.plot(xs, [D['melt']['swe'][k][i] for i in idx], lw=1.7,
                color=COL[k], label=SHORT[k])
    ax.set_ylabel('snow water equivalent, mm')
    ax.grid(axis='y', color=RULE, lw=.7)
    ax.legend(frameon=False, fontsize=8, loc='upper right')
    ax.set_title('Provisional: driven by synthetic weather, not observations',
                 fontsize=8.5, color='#8A5A1B', pad=6)

    ax2.plot(xs, [D['melt']['temp'][i] for i in idx], lw=1, color=INK3)
    ax2.axhline(0, color=SUN, lw=.9)
    ax2.set_ylabel('mean air\ntemp, \u00b0C')
    ax2.grid(axis='y', color=RULE, lw=.7)

    ticks = [j for j, i in enumerate(idx) if dates[i].endswith('-01')]
    ax2.set_xticks(ticks)
    ax2.set_xticklabels([dates[idx[j]][:7] for j in ticks], rotation=45, ha='right')
    save(fig, 'fig5_melt_season')


pipeline(); plan(); monthly(); sweep(); melt()
