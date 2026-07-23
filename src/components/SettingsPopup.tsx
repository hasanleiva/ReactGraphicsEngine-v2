import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styled from '@emotion/styled';

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
`;

const PopupContainer = styled.div`
  background: #fff;
  padding: 32px;
  border-radius: 8px;
  width: 400px;
  max-width: 90%;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
`;

const Title = styled.h2`
  margin-top: 0;
  margin-bottom: 24px;
  font-size: 24px;
  color: #333;
  text-align: center;
`;

const Input = styled.input`
  padding: 12px;
  margin-bottom: 16px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 16px;
  width: 100%;
  box-sizing: border-box;
`;

const Button = styled.button`
  padding: 12px;
  background: #2C5364;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  margin-bottom: 16px;
  &:hover {
    background: #203A43;
  }
`;

const ErrorText = styled.p`
  color: red;
  margin-top: -8px;
  margin-bottom: 16px;
  font-size: 14px;
  text-align: center;
`;

const SuccessText = styled.p`
  color: green;
  margin-top: -8px;
  margin-bottom: 16px;
  font-size: 14px;
  text-align: center;
`;

export const SettingsPopup: React.FC = () => {
  const { showSettingsPopup, setShowSettingsPopup, user } = useAuth();
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!showSettingsPopup) return null;

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    try {
      await axios.post('/api/auth/password', { oldPassword, newPassword });
      setSuccess('Password changed successfully');
      setOldPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
    }
  };

  return (
    <Overlay className="auth-popup-container" onClick={() => setShowSettingsPopup(false)}>
      <PopupContainer onClick={(e) => e.stopPropagation()}>
        <Title>Settings</Title>
        {error && <ErrorText>{error}</ErrorText>}
        {success && <SuccessText>{success}</SuccessText>}
        {user?.role === 'admin' && (
          <Button
            onClick={() => { setShowSettingsPopup(false); navigate('/admin'); }}
            style={{ background: '#1e293b' }}
          >
            Go to Admin Panel
          </Button>
        )}
        <Input
          type="password"
          placeholder="Old Password"
          value={oldPassword} 
          onChange={(e) => setOldPassword(e.target.value)} 
        />
        <Input 
          type="password" 
          placeholder="New Password" 
          value={newPassword} 
          onChange={(e) => setNewPassword(e.target.value)} 
        />
        <Button onClick={handleSubmit}>Change Password</Button>
      </PopupContainer>
    </Overlay>
  );
};
