import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import * as yup from 'yup';
import FormInput from '../../../components/form/InputBar/FormInput';
import { Button, PageHeader } from '../../../components/ui';
import { useContext, useState } from 'react';
import { User, Lock, Mail } from 'lucide-react';
import { AuthContext } from '../../../store/AuthProvider';
import { userApi } from '../../../services';
import { EMAIL_REGEX, MIN_PASSWORD_LENGTH } from '../../../constants/task';
import styles from './index.module.css';

const schema = yup
  .object({
    name: yup.string().trim().required('Name cannot be empty'),
    email: yup
      .string()
      .trim()
      .required('Email cannot be empty')
      .matches(EMAIL_REGEX, { message: 'Email is not valid' }),
    oldPassword: yup.string(),
    // Validated only when the user is actually setting a new password.
    newPassword: yup
      .string()
      .test(
        'min-length-when-set',
        `Use at least ${MIN_PASSWORD_LENGTH} characters`,
        (value) => !value || value.length >= MIN_PASSWORD_LENGTH
      ),
  })
  .required();

export default function Settings() {
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
      const isPasswordChanged = Boolean(data.oldPassword && data.newPassword);

      // Only send what the user actually intends to change: posting empty
      // password fields would otherwise look like a password change attempt.
      await userApi.updateProfile({
        name: data.name,
        email: data.email,
        ...(isPasswordChanged
          ? { oldPassword: data.oldPassword, newPassword: data.newPassword }
          : {}),
      });

      // Changing the email or the password invalidates the identity the
      // current session was issued for, so the user must sign in again.
      //
      // The previous code called `setIsSafeToReset(true)` and then read
      // `isSafeToReset` in the same render — state updates are not applied
      // synchronously, so the value was still `false` and `logout()` never
      // ran. The decision is a plain local variable now; no state involved.
      const mustReauthenticate = Boolean(isEmailChanged || isPasswordChanged);

      if (mustReauthenticate) {
        toast.success('Details updated. Please log in again.');
        logout();
        return;
      }

      await updateInfo();
      reset({ ...data, oldPassword: '', newPassword: '' });
      setIsModified(false);
      toast.success('Details updated');
    } catch (error) {
      Object.entries(error.errors || {}).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });

      if (!error.isSessionExpired) toast.error(error.message);
    }
  };


  return (
    <div className={styles.container}>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your profile and sign-in details."
      />

      <form onSubmit={handleSubmit(onSubmit)} className={styles.form} noValidate>
        {/* Grouped into Profile and Security so the destructive, session-ending
            fields are visibly separate from an ordinary name change. */}
        <fieldset className={styles.section}>
          <legend className={styles.legend}>Profile</legend>

          <FormInput
            error={errors.name}
            label="name"
            fieldLabel="Name"
            register={register}
            placeholder="Your name"
            onChange={() => setIsModified(true)}
            mainIcon={<User />}
          />
          <FormInput
            error={errors.email}
            label="email"
            fieldLabel="Email address"
            register={register}
            placeholder="you@example.com"
            onChange={() => setIsModified(true)}
            mainIcon={<Mail />}
          />
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={styles.legend}>Security</legend>
          <p className={styles.hint}>
            Leave these blank to keep your current password.
          </p>

          <FormInput
            error={errors.oldPassword}
            label="oldPassword"
            fieldLabel="Current password"
            register={register}
            placeholder="Current password"
            onChange={() => setIsModified(true)}
            mainIcon={<Lock />}
            type="password"
          />
          <FormInput
            error={errors.newPassword}
            label="newPassword"
            fieldLabel="New password"
            register={register}
            placeholder="New password"
            onChange={() => setIsModified(true)}
            mainIcon={<Lock />}
            type="password"
          />
        </fieldset>

        {/* Changing an email or password invalidates the session, so say so
            before the user submits rather than surprising them with a logout. */}
        <p className={styles.notice} role="status">
          Changing your email address or password will sign you out on this
          device, and you’ll need to log in again.
        </p>

        <div className={styles.actions}>
          {/* The button stays disabled until something actually changed, so
              "Save changes" never implies work that would be a no-op. */}
          <Button type="submit" loading={isSubmitting} disabled={!isModified}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>

          {isModified && !isSubmitting && (
            <p className={styles.unsaved} role="status">
              You have unsaved changes
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
