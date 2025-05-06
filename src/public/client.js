document.addEventListener('DOMContentLoaded', () => {
    const addToCartButtons = document.querySelectorAll('.add-to-cart');


    const userId = new URLSearchParams(window.location.search).get('userId');
    console.log(userId);
  
    addToCartButtons.forEach(button => {
      button.addEventListener('click', async () => {
        console.log(button.dataset.userId,'userId')
        if (!button.dataset.userId) {
          alert('Please register or login to add flights to cart.');
          return;
        }
        
        const flightData = {
          userId:button.dataset.userId,
          origin: button.dataset.origin,
          destination: button.dataset.destination,
          departureDate: button.dataset.departureDate,
          adults: parseInt(button.dataset.adults),
          currencyCode: button.dataset.currencyCode
        };
  
        try {
          const response = await fetch('/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flightData)
          });
  
          const result = await response.json();
          if (result.success) {
            alert('Flight added to cart!');
            window.location.reload();
          } else {
            console.error('Cart addition failed:', result);
            alert(`Failed to add flight to cart: ${result.error || 'Unknown error'}`);
          }
        } catch (error) {
          console.error('Error adding to cart:', error, { flightData });
          alert('Error adding flight to cart. Please try again.');
        }
      });
    });
  
    const logoutButton = document.getElementById('logoutBtn');
    if (logoutButton) {
      logoutButton.addEventListener('click', () => {
        window.location.href = '/';
      });
    }
  
    const clearCartButton = document.getElementById('clearCartBtn');
    if (clearCartButton) {
      clearCartButton.addEventListener('click', async () => {
        if (!userId) {
          alert('No user logged in.');
          return;
        }
  
        try {
          const response = await fetch('/clear-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
          });
  
          const result = await response.json();
          if (result.success) {
            alert('Cart cleared!');
            window.location.reload();
          } else {
            alert('Failed to clear cart: ' + result.error);
          }
        } catch (error) {
          console.error('Error clearing cart:', error);
          alert('Error clearing cart.');
        }
      });
    }
  });