import sys, glob, os, numpy as np, soundfile as sf, pyloudnorm as pyln
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
OUT='out'
meter=pyln.Meter(48000)
files=sorted(glob.glob(f'{OUT}/stem_*.wav'))+[f'{OUT}/{sys.argv[1] if len(sys.argv)>1 else "music_premaster.wav"}']
fig,axes=plt.subplots(len(files)+1,1,figsize=(16,2*len(files)+4),sharex=True)
for ax,f in zip(axes,files):
    x,sr=sf.read(f); 
    L=meter.integrated_loudness(x) if np.abs(x).max()>0 else -99
    # short-term loudness per 0.5s window (3s windows too slow): rms dBFS
    w=sr//4; nwin=len(x)//w
    rms=[20*np.log10(np.sqrt((x[i*w:(i+1)*w]**2).mean())+1e-9) for i in range(nwin)]
    ax.plot(np.arange(nwin)*0.25,rms); ax.set_ylim(-60,0); ax.set_ylabel(os.path.basename(f)[:14],fontsize=7); ax.grid(alpha=.3)
    for b in range(0,64,2): ax.axvline(b,color='k',alpha=0.08)
    print(f'{os.path.basename(f):28s} LUFS {L:6.1f}  peak {20*np.log10(np.abs(x).max()+1e-9):6.1f} dBFS')
x,sr=sf.read(files[-1]); m=x.mean(axis=1)
axes[-1].specgram(m,NFFT=2048,Fs=sr,noverlap=1024,cmap='magma',vmin=-120); axes[-1].set_ylim(0,12000)
plt.tight_layout(); plt.savefig(f'{OUT}/analysis.png',dpi=60)
# click detection: big sample-to-sample jumps relative to local level
d=np.abs(np.diff(m)); thr=np.percentile(d,99.99)
print('99.99pct diff',thr,'max diff',d.max(),'at',np.argmax(d)/sr)
