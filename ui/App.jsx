import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import Sidebar from './Sidebar';

const App = ({ children }) => (
  <BrowserRouter>
    <Sidebar />
    {children}
  </BrowserRouter>
);

export default App;

