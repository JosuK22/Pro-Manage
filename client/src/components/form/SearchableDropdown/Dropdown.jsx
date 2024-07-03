import React, { useState, useEffect, useContext } from 'react';
import Select, { components } from 'react-select';
import { AuthContext } from '../../../store/AuthProvider';
import { BACKEND_URL } from '../../../utils/connection';

import './styles.css';


// Custom SingleValue component to only display the email in the input bar
const SingleValue = ({ children, ...props }) => (
  <components.SingleValue {...props}>
    {props.data.label}
  </components.SingleValue>
);

export default function Dropdown({ onChange, assignedValue }) {
  const { user } = useContext(AuthContext);
  const { token } = user;
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null); // Track selected option

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `${BACKEND_URL}/api/v1/assignees`,
          {
            method: 'GET',
            headers: {
              Authorization: 'Bearer ' + token,
            },
          }
        );
        if (!response.ok) {
          throw new Error('Failed to fetch assignees');
        }
        const { data } = await response.json();
        const emailArray = data.map((item) => item.email);

        const formattedOptions = emailArray.map((email) => ({
          value: email,
          label: email,
          customLabel: email.substring(0, 2), 
        }));

        setOptions(formattedOptions);

        // Set selected option based on assignedValue
        if (assignedValue) {
          const selected = formattedOptions.find(option => option.value === assignedValue);
          setSelectedOption(selected);
        }
      } catch (error) {
        console.error('Error fetching assignees:', error);
        setOptions([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [token, assignedValue]);

  const handleOnChange = (selectedOption) => {
    setSelectedOption(selectedOption); // Update selected option state
    onChange(selectedOption); // Propagate change to parent component
  };

  const getOptionLabel = (option) => (
    <div className="boardLists">
      <div className='intialsContainer'>
        <span className="initials">{option.customLabel}</span>
      </div>
      <div className='emailContainer'>
        <span className="members">{option.label}</span>
      </div>
      <button className="assignButton">Assign</button>
    </div>
  );

  return (
    <Select
      options={options}
      value={selectedOption} // Set selected option
      onChange={handleOnChange} // Handle change event
      placeholder="Add an assignee"
      isSearchable
      isClearable
      styles={{
        control: (baseStyles, state) => ({
          ...baseStyles,
          border: 'none',
        }),
      }}
      isLoading={isLoading}
      getOptionLabel={getOptionLabel}
      components={{ SingleValue }} // Use custom SingleValue component
      className='react-select-container'
      classNamePrefix="react-select"
    />
  );
}
