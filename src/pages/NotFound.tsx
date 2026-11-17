import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.tsx';

export function NotFoundPage() {
  return <EmptyState title="Page not found" action={<Link className="btn" to="/">Go to today</Link>}>That page doesn’t exist or you don’t have access to it.</EmptyState>;
}
