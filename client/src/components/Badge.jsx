import { AlertTriangle, CheckCircle2, Clock, Loader2, Trash2, UploadCloud } from 'lucide-react';

const MAP = {
  READY: { Icon: CheckCircle2, label: 'READY' },
  PROCESSING: { Icon: Loader2, label: 'PROCESSING', spin: true },
  UPLOADING: { Icon: UploadCloud, label: 'UPLOADING' },
  FAILED: { Icon: AlertTriangle, label: 'FAILED' },
  EXPIRED: { Icon: Clock, label: 'EXPIRED' },
  DELETING: { Icon: Trash2, label: 'DELETING' },
  DELETED: { Icon: Trash2, label: 'DELETED' },
};

export default function Badge({ status }) {
  const { Icon, label, spin } = MAP[status] || MAP.FAILED;
  return (
    <span className={`badge badge-${status}`}>
      <Icon className={spin ? 'spin' : ''} aria-hidden="true" />
      {label}
    </span>
  );
}
