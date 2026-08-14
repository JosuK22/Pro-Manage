import { useContext } from 'react';
import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as yup from 'yup';
import { LockKeyhole, Mail, User } from 'lucide-react';

import { AuthContext } from '../../../store/AuthProvider';
import { authApi } from '../../../services';
import FormInput from '../../../components/form/InputBar/FormInput';
import { Button } from '../../../components/ui';
import Form from '../Form/Form';
import { EMAIL_REGEX, MIN_PASSWORD_LENGTH } from '../../../constants/task';

import styles from './styles.module.css';

const message = '* This field is required';

const schema = yup
  .object({
    name: yup.string().required(message),
    email: yup
      .string()
      .required(message)
      .matches(EMAIL_REGEX, { message: 'Email is not valid' }),
    // Mirrors the server's policy so the user is told before the round-trip.
    password: yup
      .string()
      .required(message)
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: yup
      .string()
      .required(message)
      .oneOf([yup.ref('password')], 'Passwords do not match'),
  })
  .required();

const defaultValues = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

export default function Register() {
  const authCtx = useContext(AuthContext);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues,
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data) => {
   
    try {
      // The API returns { info, token } on registration, so the user is signed
      // in immediately instead of being bounced back to the login form.
      const resJson = await authApi.register(data);
      authCtx.login(resJson.data);

      toast.success('Welcome to Pro Manage!');

      // No reset() here: this component unmounts on navigation, and resetting
      // a form that is about to disappear was what the old `isSafeToReset`
      // effect was working around.
      navigate('/', { replace: true });
    } catch (error) {
      Object.entries(error.errors || {}).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });

      toast.error(error.message);
    }
  };

  return (
    <Form title="Register">
      <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>
        <FormInput
          error={errors.name}
          label="name"
          register={register}
          placeholder={'Name'}
          mainIcon={<User />}
        />
        <FormInput
          error={errors.email}
          label="email"
          placeholder={'Email'}
          register={register}
          mainIcon={<Mail />}
        />
        <FormInput
          error={errors.password}
          label={'password'}
          register={register}
          type="password"
          placeholder={'Password'}
          mainIcon={<LockKeyhole />}
        />
        <FormInput
          error={errors.confirmPassword}
          label={'confirmPassword'}
          register={register}
          type="password"
          placeholder={'Confirm Password'}
          mainIcon={<LockKeyhole />}
        />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registering...' : 'Register'}
        </Button>
      </form>
    </Form>
  );
}
