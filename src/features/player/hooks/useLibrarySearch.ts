import { createContext, useContext } from 'react'

export const LibrarySearchContext = createContext<(() => void) | undefined>(undefined)
export const useLibrarySearch = () => useContext(LibrarySearchContext)
