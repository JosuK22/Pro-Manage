import { useCallback, useState } from 'react';

export default function useModal() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleModal = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return { isOpen, toggleModal };
}
