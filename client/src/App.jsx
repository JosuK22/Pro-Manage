import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import AdminLayout from './pages/Admin';
import AuthLayout from './pages/Auth';
import PublicLayout from './pages/Public';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import AuthProvider from './store/AuthProvider';
import Board from './pages/Admin/Board';
import Analytics from './pages/Admin/Analytics';
import Settings from './pages/Admin/Settings';
import TaskProvider from './store/TaskProvider';

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <AuthProvider>
        <AdminLayout />
      </AuthProvider>
    ),
    children: [
      {
        index: true,
        element: (
          <TaskProvider>
            <Board />
          </TaskProvider>
        ),
      },
      {
        path: 'analytics',
        element: <Analytics />,
      },
      { path: 'settings', element: <Settings /> },
    ],
  },
  {
    path: '/auth',
    element: (
      <AuthProvider>
        <AuthLayout />
      </AuthProvider>
    ),
    children: [
      {
        index: true,
        element: <Login />,
      },
      {
        path: 'register',
        element: <Register />,
      },
    ],
  },
  {
    path: '/tasks/:taskId',
    element: <PublicLayout />,
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
