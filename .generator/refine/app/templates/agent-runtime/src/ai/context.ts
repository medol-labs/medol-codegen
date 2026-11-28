import {createContext} from 'react';
import type {AgentStore} from './store';
export const AgentContext = createContext<AgentStore | null>(null);
