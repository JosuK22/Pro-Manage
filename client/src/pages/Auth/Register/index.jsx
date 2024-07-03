import { useEffect, useState } from 'react';
import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import * as yup from 'yup';
import { EyeOff, LockKeyhole, Mail, User, Eye } from 'lucide-react';

import { BACKEND_URL } from '../../../utils/connection';
import FormInput from '../../../components/form/InputBar/FormInput';
import {Button} from '../../../components/ui';
import Form from '../Form/Form';

import styles from './styles.module.css';


const emailRegex = /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/;
const message = '* This field is required';

const schema = yup
  .object({
    
    name: yup.string().required(message),
    email: yup.string().required(message).matches(emailRegex, { message: 'Email is not valid' }),
    password: yup.string().required(message),
    confirmPassword: yup.string().required(message).oneOf([yup.ref('password')], 'Passwords do not match'),
  })
  .required();

const defaultValues = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

export default function Register() {
  const [isSafeToReset, setIsSafeToReset] = useState(false);

  

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues,
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data) => {
   
    try {
      const res = await fetch(
        BACKEND_URL + '/api/v1/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(data),
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) {
        const errJson = await res.json();
        console.log(errJson);
        const { errors } = errJson;

        for (const property in errors) {
          setError(property, { type: 'custom', message: errors[property] });
        }

        throw new Error(errJson.message);
      }

      toast.success('Successfully registered!');
      setIsSafeToReset(true);
    } catch (error) {
      toast.error(error.message);
      console.log(error.message);
    }
  };
  

  useEffect(() => {
    if (!isSafeToReset) return;

    reset(defaultValues); 
  }, [reset, isSafeToReset]);

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
          secondaryIcon={<Eye/>}
          tertiaryIcon ={<EyeOff/>}
        />
        <FormInput
          error={errors.confirmPassword}
          label={'confirmPassword'}
          register={register}
          type="password"
          placeholder={'Confirm Password'}
          mainIcon={<LockKeyhole />}
          secondaryIcon={<Eye/>}
          tertiaryIcon ={<EyeOff/>}
        />

        <Button>{isSubmitting ? 'Registering...' : 'Register'}</Button>
      </form>
    </Form>
  );
}
