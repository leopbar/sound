import { useSearchStore } from '../store/searchStore';
import TrackList from './TrackList';

export default function SearchResults() {
  const { query, searched, items, loading, error } = useSearchStore();
  if (!searched) return null;

  return (
    <TrackList
      tracks={items}
      loading={loading}
      error={error}
      emptyText={`Nenhum vídeo encontrado para “${query}”.`}
    />
  );
}
