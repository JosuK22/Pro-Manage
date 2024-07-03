import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import * as yup from 'yup';
import FormInput from '../../../components/form/InputBar/FormInput';
import { Button, Text } from '../../../components/ui';
import { useContext, useEffect, useState } from 'react';
import { Eye, User, Lock, Mail, EyeOff } from 'lucide-react';
import { AuthContext } from '../../../store/AuthProvider';
import { BACKEND_URL } from '../../../utils/connection';
import styles from './index.module.css';

const schema = yup
  .object({
    name: yup.string(),
    email: yup.string(),
    newPassword: yup.string(),
    oldPassword: yup.string(),
  })
  .required();

export default function Settings() {
  const [isSafeToReset, setIsSafeToReset] = useState(false);
  const { user, updateInfo, logout } = useContext(AuthContext);
  const [isModified, setIsModified] = useState(false);


  const defaultValues = {
    name: user?.info?.name || '',
    email: user?.info?.email || '',
    oldPassword: '',
    newPassword: '',
  };

  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting }, } = useForm({
    defaultValues,
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data) => {
    try {
      if (data.oldPassword && data.newPassword === data.oldPassword) {
        toast.error("New password cannot be the same as the old password");
        return;
      }
  
      const isEmailChanged = data.email !== user.info.email;
      const isPasswordChanged = data.oldPassword && data.newPassword;
  
      const res = await fetch(BACKEND_URL + '/api/v1/users', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + user.token,
        },
      });
  
      if (!res.ok) {
        const errJson = await res.json();
        const { errors } = errJson;
  
        for (const property in errors) {
          setError(property, { type: 'custom', message: errors[property] });
        }
  
        throw new Error(errJson.message);
      }
  
      setIsSafeToReset(true);
      await updateInfo(isEmailChanged || isPasswordChanged); 
  
      setIsModified(false); 
  
      if (isSafeToReset) {
        logout();
      }
    } catch (error) {
      toast.error(error.message);
      console.log(error.message);
    }
  };
  
  
  
  


  useEffect(() => {
    if (!isSafeToReset) return;
  
    reset(defaultValues);
    setIsSafeToReset(false); 
  }, [reset, isSafeToReset]);
  

  return (
    <div className={styles.container}>
      <Text step={5} weight="500">
        Settings
      </Text>

      <form onSubmit={handleSubmit(onSubmit)}>
        <FormInput
          error={errors.name}
          label="name"
          register={register}
          placeholder={'Name'}
          onChange={() => setIsModified(true)}
          mainIcon={<User />}
        />
        <FormInput
          error={errors.email}
          label="email"
          register={register}
          placeholder={'Email'}
          onChange={() => setIsModified(true)}
          mainIcon={<Mail />}
        />
        <FormInput
          error={errors.oldPassword}
          label="oldPassword"
          register={register}
          placeholder={'Old Password'}
          secondaryIcon={<EyeOff/>}
          tertiaryIcon ={<Eye/>}
          mainIcon={<Lock />}
          type="password"
        />
        <FormInput
          error={errors.newPassword}
          label="newPassword"
          register={register}
          placeholder={'New Password'}
          mainIcon={<Lock />}
          secondaryIcon={<EyeOff />}
          tertiaryIcon ={<Eye/>}
          onChange={() => setIsModified(true)}
          type="password"
        />

        <Button>{isSubmitting ? 'Updating...' : 'Update'}</Button>
      </form>

    </div>
  );
}
