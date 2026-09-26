import { useEffect, useState } from 'react';

export type Route = 'play' | 'how' | 'about';

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h === 'how' || h === 'about' ? h : 'play';
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
