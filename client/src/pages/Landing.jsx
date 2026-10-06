import { Link } from 'react-router-dom';
import { ArrowDown, Clock, Link2, Play, Timer, UploadCloud } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';

const FEATURES = [
  { n: '01', title: 'Upload', text: 'Upload large videos with progress tracking.', Icon: UploadCloud },
  { n: '02', title: 'Share', text: 'Generate a private link instantly.', Icon: Link2 },
  { n: '03', title: 'Watch', text: 'Stream directly from your browser.', Icon: Play },
  { n: '04', title: 'Expire', text: 'Links and videos automatically disappear after expiry.', Icon: Timer },
];
const STEPS = ['Upload', 'Set Expiry', 'Generate Link', 'Share', 'Watch', 'Auto Delete'];

export default function Landing() {
  const { authed } = useAuth();
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow"><span className="dot" aria-hidden="true" /> Share videos privately. Watch anywhere. Automatically expire.</p>
        <h1 id="hero-title" className="hero-title">
          <span className="wordmark">REELVAULT</span>
          Private video sharing,<br /><em>without the hassle.</em>
        </h1>
        <p className="hero-sub">Your videos. Your link. Your control.</p>
        <div className="hero-cta">
          <Link to={authed ? '/upload' : '/login?next=/upload'} className="btn btn-primary btn-lg"><UploadCloud aria-hidden="true" /> Upload a Video</Link>
          <a href="#how" className="btn btn-lg">How it works</a>
        </div>
        <p className="flow-line" aria-hidden="true">Upload → Get a link → Share → Watch → Expire</p>

        <div className="screen" aria-hidden="true">
          <div className="screen-glow" />
          <div className="screen-frame">
            <div className="screen-play"><Play fill="currentColor" /></div>
            <div className="screen-bar"><span className="screen-time">0:42</span><div className="screen-track"><i /></div><span className="screen-time">1:52:10</span></div>
            <div className="screen-chip"><Clock /> Expires in 5 days 12 hours</div>
          </div>
        </div>
      </section>

      <section className="features" aria-label="Features">
        {FEATURES.map(({ n, title, text, Icon }) => (
          <article className="feature card" key={n}>
            <div className="feature-top"><span className="feature-n">{n}</span><Icon aria-hidden="true" /></div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section id="how" className="how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s}><span className="step-i">{i + 1}</span><span>{s}</span>{i < STEPS.length - 1 && <ArrowDown className="step-arrow" aria-hidden="true" />}</li>
          ))}
        </ol>
      </section>
    </>
  );
}
