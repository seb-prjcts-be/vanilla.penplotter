"""One line on screen, then on the physical plotter. Coarse CGA pixels."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).resolve().parents[1]/'docs/images/animations/overview.gif'
FONT=ImageFont.load_default(size=10)
PALETTE=[0,0,0,85,255,255,255,85,255,255,255,255,255,85,85]+[0]*(768-15)
frames=[]
for tick in range(70):
    im=Image.new('P',(320,240),0); im.putpalette(PALETTE)
    d=ImageDraw.Draw(im)
    d.text((12,18),'vanilla.penplotter',font=FONT,fill=3)
    d.rectangle((12,63,137,151),outline=1)
    d.rectangle((16,67,133,147),fill=3)
    d.line((12,160,137,160),fill=1)
    d.rectangle((184,32,291,180),fill=3)
    for x in (178,181,295,298):d.line((x,29,x,187),fill=1)
    # Same physical X axis and home as Setup: X up, Y right.
    home=(184,180);start=(190,162);end=(190,122)
    head=home
    if tick<12:
        message='Draw'
        if tick>2:d.line((36,103,36+min(tick-2,8)*10,103),fill=2)
    else:
        d.line((36,103,116,103),fill=2)
        message='Click Plot'
        if tick>=22:
            message='Plot'
            if tick<30:
                t=(tick-22)/8
                head=(home[0]+(start[0]-home[0])*t,home[1]+(start[1]-home[1])*t)
            elif tick<50:
                t=(tick-30)/20
                head=(start[0],start[1]+(end[1]-start[1])*t)
                d.line((*start,*head),fill=2)
            else:
                d.line((*start,*end),fill=2)
                t=min((tick-50)/8,1)
                head=(end[0]+(home[0]-end[0])*t,end[1]+(home[1]-end[1])*t)
                if tick>=58:message='Done'
    d.rectangle((175,head[1],301,head[1]+6),outline=1)
    d.rectangle((head[0]-3,head[1]-4,head[0]+3,head[1]+7),fill=0,outline=2)
    d.line((181,187,187,181),fill=4);d.line((181,181,187,187),fill=4)
    d.rectangle((225,195,252,216),outline=1)
    d.rectangle((229,200,236,210),outline=3)
    d.rectangle((242,200,246,204),fill=4 if tick%8<4 else 0)
    d.text((12,180),message,font=FONT,fill=1)
    frames.append(im.resize((640,480),Image.Resampling.NEAREST))
frames[0].save(OUT,save_all=True,append_images=frames[1:],duration=100,
               loop=0,optimize=False,disposal=2)
