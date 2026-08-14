import { useContext } from 'react';
import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import * as yup from 'yup';
import { Lock, Mail } from 'lucide-react';

import { AuthContext } from '../../../store/AuthProvider.jsx';
import FormInput from '../../../components/form/InputBar/FormInput.jsx';
import {Button, LineLoader} from '../../../components/ui';
import Form from '../Form/Form.jsx';
import { authApi } from '../../../services';
import { EMAIL_REGEX } from '../../../constants/task.js';

import styles from './styles.module.css';

const message = '* This field is required';

const userSchema = yup
  .object({
    email: yup
      .string()
      .required(message)
      .matches(EMAIL_REGEX, { message: 'Invalid email format' }),
    password: yup.string().required(message),
  })
  .required();

export default function Login() {
  const authCtx = useContext(AuthContext);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
    resolver: yupResolver(userSchema),
  });

  const onSubmit = async (data) => {
    try {
      const resJson = await authApi.login(data);

      authCtx.login(resJson.data);
      navigate('/', { replace: true });
    } catch (error) {
      // Attach any field-level messages the API returned, then report the rest.
      Object.entries(error.errors || {}).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });

      toast.error(error.message);
    }
  };

  return (
    <Form title="Login">
      <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>
        <FormInput
          error={errors.email}
          label="email"
          register={register}
          placeholder={'Email'}
          mainIcon={<Mail />}
        />
        <FormInput
          error={errors.password}
          label="password"
          register={register}
          type="password"
          placeholder={'Password'}
          mainIcon={<Lock />}
        />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <LineLoader /> : 'Login'}
        </Button>
      </form>
    </Form>
  );
}
