import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import Select from 'react-select';

import { assigneeApi } from '../../../services';

import './styles.css';

/**
 * Assignee picker.
 *
 * Fetches the current user's board members and lets them be searched by email.
 * Uses the shared API client — this component previously reached for axios,
 * which meant the app shipped two HTTP stacks with two different auth and
 * error conventions.
 */
export default function Dropdown({ id, onChange, assignedValue }) {
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const fetchAssignees = async () => {
      setIsLoading(true);
      try {
        const res = await assigneeApi.list({ signal: controller.signal });

        setOptions(
          res.data.assignees.map((assignee) => ({
            value: assignee.email,
            label: assignee.email,
            initials: assignee.email.substring(0, 2).toUpperCase(),
          }))
        );
      } catch (err) {
        if (err.name !== 'AbortError') setOptions([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssignees();

    return () => controller.abort();
    // Board members are per-user and change only via the "Add people" flow,
    // so one fetch per mount is enough.
  }, []);

  // Derive the selection from the prop instead of mirroring it in state — the
  // old copy could go stale when the form was reopened for a different task.
  const selectedOption = assignedValue
    ? options.find((option) => option.value === assignedValue) ?? {
        // The assignee may no longer be on the board; still show what the task
        // actually holds rather than silently blanking the field.
        value: assignedValue,
        label: assignedValue,
        initials: assignedValue.substring(0, 2).toUpperCase(),
      }
    : null;

  // react-select filters on the *string* returned here. Returning JSX (as the
  // old code did) made every option stringify to "[object Object]", so typing
  // matched nothing. Custom rendering belongs in formatOptionLabel.
  const getOptionLabel = (option) => option.label;

  const formatOptionLabel = (option, { context }) => {
    if (context === 'value') return option.label;

    return (
      <div className="boardLists">
        <div className="intialsContainer">
          <span className="initials">{option.initials}</span>
        </div>
        <div className="emailContainer">
          <span className="members">{option.label}</span>
        </div>
        <span className="assignButton">Assign</span>
      </div>
    );
  };

  return (
    <Select
      inputId={id}
      options={options}
      value={selectedOption}
      onChange={(option) => onChange(option)}
      placeholder="Add an assignee"
      noOptionsMessage={() => 'No board members yet — add people to the board first'}
      isSearchable
      isClearable
      isLoading={isLoading}
      getOptionLabel={getOptionLabel}
      formatOptionLabel={formatOptionLabel}
      styles={{ control: (base) => ({ ...base, border: 'none' }) }}
      className="react-select-container"
      classNamePrefix="react-select"
    />
  );
}

Dropdown.propTypes = {
  id: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  assignedValue: PropTypes.string,
};
