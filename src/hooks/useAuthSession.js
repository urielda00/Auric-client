import { useEffect, useState } from "react";

import { authSession } from "../services/authSession";

export function useAuthSession() {
  const [state, setState] = useState(authSession.snapshot());

  useEffect(() => {
    const unsubscribe = authSession.subscribe(setState);
    void authSession.hydrate();
    return unsubscribe;
  }, []);

  return state;
}

export default useAuthSession;
